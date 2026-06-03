import { Router, Request, Response } from 'express'
import axios from 'axios'
import { prisma } from '../lib/prisma'
import { TrackingSystem } from '@prisma/client'
import { notifyFaturado } from '../services/notifier'

const router = Router()
const publicRouter = Router()

// Cache em memória — populado do banco na inicialização via loadTokensFromDB()
const tokens: Record<string, { access_token: string; refresh_token: string }> = {}

// Lock para evitar syncs paralelos (ex: múltiplos restarts do Railway)
let syncRunning = false

type BlingProgressCallback = (data: { company: string; criados: number; ignorados: number; currentNf?: string }) => void

export async function loadTokensFromDB() {
  const rows = await prisma.blingToken.findMany()
  for (const row of rows) {
    tokens[row.companyKey] = { access_token: row.accessToken, refresh_token: row.refreshToken }
  }
  console.log(`[Bling] Tokens carregados do banco: ${rows.map(r => r.companyKey).join(', ') || 'nenhum'}`)
}

async function saveToken(companyKey: string) {
  const t = tokens[companyKey]
  if (!t) return
  await prisma.blingToken.upsert({
    where: { companyKey },
    update: { accessToken: t.access_token, refreshToken: t.refresh_token },
    create: { companyKey, accessToken: t.access_token, refreshToken: t.refresh_token },
  })
}

async function deleteToken(companyKey: string) {
  delete tokens[companyKey]
  await prisma.blingToken.deleteMany({ where: { companyKey } })
}

const BLING_REDIRECT_URI = process.env.BLING_REDIRECT_URI!
const BLING_API = 'https://api.bling.com.br/Api/v3'
const BLING_AUTH_URL = 'https://www.bling.com.br/Api/v3/oauth/authorize'
const BLING_TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token'

// Transportadoras ignoradas no sync (sem API de rastreamento e sem interesse)
const CARRIERS_BLOCKED = ['GARBERG', 'TNT', 'HS MOVERE', 'PAC']

// Configuração das 3 empresas
const COMPANIES: Record<string, { name: string; code: string; cnpj: string; clientId: string; clientSecret: string }> = {
  avic: {
    name: 'Avic',
    code: 'AVIC',
    cnpj: '47.715.256/0001-49',
    clientId: process.env.BLING_AVIC_CLIENT_ID!,
    clientSecret: process.env.BLING_AVIC_CLIENT_SECRET!,
  },
  agrogranja: {
    name: 'Agrogranja',
    code: 'AGRO',
    cnpj: '54.695.386/0001-22',
    clientId: process.env.BLING_AGROGRANJA_CLIENT_ID!,
    clientSecret: process.env.BLING_AGROGRANJA_CLIENT_SECRET!,
  },
  equipage: {
    name: 'Equipage',
    code: 'EQUI',
    cnpj: '56.633.474/0001-25',
    clientId: process.env.BLING_EQUIPAGE_CLIENT_ID!,
    clientSecret: process.env.BLING_EQUIPAGE_CLIENT_SECRET!,
  },
}


// GET /api/bling/status - status de conexão de todas as empresas
router.get('/status', (_req: Request, res: Response) => {
  const status = Object.entries(COMPANIES).map(([key, company]) => ({
    key,
    name: company.name,
    cnpj: company.cnpj,
    connected: !!tokens[key],
    configured: !!company.clientId && !!company.clientSecret,
  }))
  res.json(status)
})

// GET /api/bling/auth/:company - inicia OAuth para a empresa (rota pública)
publicRouter.get('/auth/:company', (req: Request, res: Response) => {
  const company = COMPANIES[req.params.company]
  if (!company) return res.status(404).json({ error: 'Empresa não encontrada' })
  if (!company.clientId) return res.status(400).json({ error: 'Credenciais não configuradas para esta empresa' })

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: company.clientId,
    redirect_uri: BLING_REDIRECT_URI,
    state: req.params.company,
  })
  res.redirect(`${BLING_AUTH_URL}?${params.toString()}`)
})

// GET /api/bling/callback - recebe código e identifica empresa pelo state (rota pública)
publicRouter.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query
  const companyKey = state as string
  const company = COMPANIES[companyKey]

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
  if (!code || !company) {
    return res.redirect(`${frontendUrl}?bling=error`)
  }

  try {
    const credentials = Buffer.from(`${company.clientId}:${company.clientSecret}`).toString('base64')

    const response = await axios.post(
      BLING_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: BLING_REDIRECT_URI,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
      }
    )

    tokens[companyKey] = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
    }
    await saveToken(companyKey)

    res.redirect(`${frontendUrl}?bling=connected&company=${companyKey}`)
  } catch (err) {
    console.error(`Erro ao autenticar ${companyKey}:`, err)
    res.redirect(`${frontendUrl}?bling=error`)
  }
})

// Renova token de uma empresa
async function refreshToken(companyKey: string) {
  const company = COMPANIES[companyKey]
  const token = tokens[companyKey]
  if (!token?.refresh_token) throw new Error('Sem refresh token')

  const credentials = Buffer.from(`${company.clientId}:${company.clientSecret}`).toString('base64')

  const response = await axios.post(
    BLING_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
    }
  )

  tokens[companyKey] = {
    access_token: response.data.access_token,
    refresh_token: response.data.refresh_token,
  }
  await saveToken(companyKey)
}

// Chamada autenticada ao Bling por empresa (com retry em 401 e 429)
async function blingGet(companyKey: string, path: string, retries = 5): Promise<unknown> {
  const token = tokens[companyKey]
  if (!token) {
    // Tenta recarregar do banco antes de desistir
    await loadTokensFromDB()
    if (!tokens[companyKey]) throw new Error(`Empresa ${companyKey} não conectada`)
  }

  try {
    const response = await axios.get(`${BLING_API}${path}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    return response.data
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      if (err.response?.status === 401) {
        await refreshToken(companyKey)
        const response = await axios.get(`${BLING_API}${path}`, {
          headers: { Authorization: `Bearer ${tokens[companyKey].access_token}` },
        })
        return response.data
      }
      if (err.response?.status === 429 && retries > 0) {
        const wait = (6 - retries) * 5000 // 5s, 10s, 15s, 20s, 25s
        console.warn(`[Bling] Rate limit (429) em ${path}. Aguardando ${wait / 1000}s antes de tentar novamente...`)
        await new Promise((r) => setTimeout(r, wait))
        return blingGet(companyKey, path, retries - 1)
      }
    }
    throw err
  }
}

interface ResolveCarrierResult {
  carrierId: string
  linkDanfe: string | null
}

// Busca e vincula transportadora de uma NF pelo ID interno do Bling
async function resolveCarrier(companyKey: string, nfId: number, nfNumero: string): Promise<ResolveCarrierResult | undefined> {
  try {
    const detail = (await blingGet(companyKey, `/nfe/${nfId}`)) as BlingNFeDetailResponse
    const transportador = detail?.data?.transporte?.transportador
    const linkDanfe = detail?.data?.linkDanfe ?? null
    if (!transportador?.numeroDocumento) return undefined

    const cnpjRaw = transportador.numeroDocumento
    const cnpjNormalizado = cnpjRaw.replace(/\D/g, '')

    // Busca por CNPJ normalizado (só dígitos) ou pelo valor exato do Bling
    const existing = await prisma.carrier.findFirst({
      where: { OR: [{ cnpj: cnpjNormalizado }, { cnpj: cnpjRaw }] },
    })
    if (existing) {
      // Garante que transportadoras bloqueadas recriadas manualmente não sejam vinculadas
      const bloqueadaExistente = CARRIERS_BLOCKED.some(t => new RegExp(`\\b${t}\\b`).test(existing.name.toUpperCase()))
      if (bloqueadaExistente) {
        console.log(`[Bling] NF ${nfNumero}: transportadora bloqueada ("${existing.name}") — ignorada`)
        return undefined
      }
      // Só importa se a transportadora tem API de rastreamento configurada
      if (existing.trackingSystem === TrackingSystem.NONE) {
        console.log(`[Bling] NF ${nfNumero}: transportadora "${existing.name}" sem API de rastreamento — ignorada`)
        return undefined
      }
      console.log(`[Bling] NF ${nfNumero}: transportadora "${transportador.nome}" vinculada a "${existing.name}"`)
      return { carrierId: existing.id, linkDanfe }
    }
    if (transportador.nome) {
      // Ignora envios do Mercado Livre — não há rastreio disponível
      if (/mercado/i.test(transportador.nome)) {
        console.log(`[Bling] NF ${nfNumero}: Mercado Envios — ignorada`)
        return undefined
      }

      // Ignora transportadoras bloqueadas
      const bloqueada = CARRIERS_BLOCKED.some(t => new RegExp(`\\b${t}\\b`).test((transportador.nome ?? '').toUpperCase()))
      if (bloqueada) {
        console.log(`[Bling] NF ${nfNumero}: transportadora bloqueada ("${transportador.nome}") — ignorada`)
        return undefined
      }

      // Antes de criar, verifica se já existe transportadora com o mesmo nome (filiais com CNPJs diferentes)
      const existingByName = await prisma.carrier.findFirst({
        where: { name: transportador.nome },
      })
      if (existingByName) {
        if (existingByName.trackingSystem === TrackingSystem.NONE) {
          console.log(`[Bling] NF ${nfNumero}: transportadora "${existingByName.name}" sem API de rastreamento — ignorada`)
          return undefined
        }
        console.log(`[Bling] NF ${nfNumero}: transportadora "${transportador.nome}" vinculada pelo nome (CNPJ diferente: ${cnpjNormalizado})`)
        return { carrierId: existingByName.id, linkDanfe }
      }

      try {
        // Cria o registro para visibilidade no painel, mas não importa a NF ainda
        // (aguarda configuração do trackingSystem pelo admin)
        await prisma.carrier.create({
          data: { name: transportador.nome, cnpj: cnpjNormalizado, phone: '' },
        })
        console.log(`[Bling] NF ${nfNumero}: transportadora "${transportador.nome}" criada (sem API configurada — NF ignorada)`)
        return undefined
      } catch (createErr: unknown) {
        // Se outra requisição concorrente já criou, verifica se tem API antes de retornar
        if (createErr instanceof Error && 'code' in createErr && (createErr as { code: string }).code === 'P2002') {
          const found = await prisma.carrier.findFirst({
            where: { OR: [{ cnpj: cnpjNormalizado }, { cnpj: cnpjRaw }] },
          })
          if (found && found.trackingSystem !== TrackingSystem.NONE) return { carrierId: found.id, linkDanfe }
          return undefined
        }
        throw createErr
      }
    }
  } catch (err) {
    console.warn(`[Bling] Não foi possível buscar detalhes da NF ${nfNumero}:`, err)
  }
  return undefined
}

// POST /api/bling/sync - importa NFs de todas as empresas conectadas
export async function runBlingSync(limite?: number, onlyCompany?: string, onProgress?: BlingProgressCallback) {
  if (syncRunning) {
    console.log('[Bling] Sync já em andamento — chamada duplicada ignorada.')
    return { totalCriados: 0, totalIgnorados: 0, results: {} }
  }
  syncRunning = true

  try {
  const connectedCompanies = Object.keys(COMPANIES).filter((key) => !!tokens[key] && (!onlyCompany || key === onlyCompany))

  if (connectedCompanies.length === 0) {
    console.log('[Bling] Nenhuma empresa conectada — sync ignorado.')
    return { totalCriados: 0, totalIgnorados: 0, results: {} }
  }

  const results: Record<string, { criados: number; ignorados: number }> = {}
  let runningCriados = 0
  let runningIgnorados = 0

  for (const companyKey of connectedCompanies) {
    const company = COMPANIES[companyKey]
    let criados = 0
    let ignorados = 0

    try {
      // Importa NFs dos últimos 90 dias com paginação
      const dataInicio = new Date()
      dataInicio.setDate(dataInicio.getDate() - 90)
      const dataInicioStr = dataInicio.toISOString().slice(0, 10)

      // Carrega nfNumbers já existentes para esta empresa em memória (evita N consultas ao banco)
      const existingOrders = await prisma.order.findMany({
        where: { senderCnpj: company.cnpj },
        select: { id: true, nfNumber: true, customerPhone: true, recipientCnpj: true },
      })
      const existingMap = new Map(existingOrders.map(o => [o.nfNumber, o]))

      let pagina = 1
      let totalNFs = 0
      while (true) {
        const nfeData = (await blingGet(companyKey, `/nfe?pagina=${pagina}&limite=100&dataEmissaoInicial=${dataInicioStr}`)) as BlingListResponse
        const nfes: BlingNFe[] = nfeData?.data ?? []
        console.log(`[Bling] ${company.name} — página ${pagina}: ${nfes.length} NFs`)
        if (nfes.length === 0) break
        totalNFs += nfes.length

        for (const nf of nfes) {
          if (limite && criados >= limite) break

          // Deduplicação por nfNumber em memória (sem consulta ao banco)
          const existing = existingMap.get(String(nf.numero))

          if (existing) {
            // Preenche campos que ainda não estão salvos
            const phone = nf.contato?.telefone?.replace(/\D/g, '') || null
            const recipientCnpj = (nf.contato?.numeroDocumento ?? nf.destinatario?.numeroDocumento)?.replace(/\D/g, '') || null
            const updates: Record<string, unknown> = {}
            if (phone && !existing.customerPhone) updates.customerPhone = phone
            if (recipientCnpj && !existing.recipientCnpj) updates.recipientCnpj = recipientCnpj
            if (Object.keys(updates).length > 0) {
              await prisma.order.update({ where: { id: existing.id }, data: updates })
            }
            ignorados++
            runningIgnorados++
            onProgress?.({ company: company.name, criados: runningCriados, ignorados: runningIgnorados, currentNf: String(nf.numero) })
            continue
          }

          await new Promise((r) => setTimeout(r, 200)) // delay reduzido — retry automático em caso de 429
          const resolved = await resolveCarrier(companyKey, nf.id, String(nf.numero))

          // Sem transportadora rastreável → ignora (ex: Mercado Envios, sem transporte)
          if (!resolved) {
            ignorados++
            runningIgnorados++
            onProgress?.({ company: company.name, criados: runningCriados, ignorados: runningIgnorados, currentNf: String(nf.numero) })
            continue
          }

          const newOrder = await prisma.order.create({
            data: {
              orderNumber: `${company.code}-NF-${nf.numero}`,
              customerName: nf.contato?.nome ?? 'Cliente não informado',
              customerEmail: nf.contato?.email ?? null,
              customerPhone: nf.contato?.telefone?.replace(/\D/g, '') || null,
              nfNumber: String(nf.numero),
              nfValue: nf.valor ?? null,
              nfIssuedAt: nf.dataEmissao ? new Date(nf.dataEmissao) : null,
              senderCnpj: company.cnpj,
              recipientCnpj: (nf.contato?.numeroDocumento ?? nf.destinatario?.numeroDocumento)?.replace(/\D/g, '') ?? null,
              carrierId: resolved.carrierId,
              linkDanfe: resolved.linkDanfe,
              statusHistory: { create: { status: 'PENDING', note: `Importado do Bling (${company.name})` } },
            },
          })

          // Notifica cliente: pedido FATURADO (fire-and-forget)
          notifyFaturado({
            id: newOrder.id,
            orderNumber: newOrder.orderNumber,
            nfNumber: newOrder.nfNumber,
            customerName: newOrder.customerName,
            customerEmail: newOrder.customerEmail,
            customerPhone: newOrder.customerPhone,
            senderCnpj: newOrder.senderCnpj,
            linkDanfe: resolved.linkDanfe,
            nfIssuedAt: newOrder.nfIssuedAt,
          }).catch(err => console.error(`[Notifier] Erro ao notificar FATURADO ${newOrder.orderNumber}:`, err))

          criados++
          runningCriados++
          onProgress?.({ company: company.name, criados: runningCriados, ignorados: runningIgnorados, currentNf: String(nf.numero) })
        }

        if (limite && criados >= limite) break
        pagina++
      }
      console.log(`[Bling] ${company.name}: total ${totalNFs} NFs processadas`)
    } catch (err) {
      console.error(`Erro ao sincronizar ${companyKey}:`, err)
    }

    results[companyKey] = { criados, ignorados }
  }

  const totalCriados = Object.values(results).reduce((s, r) => s + r.criados, 0)
  const totalIgnorados = Object.values(results).reduce((s, r) => s + r.ignorados, 0)

  return { totalCriados, totalIgnorados, results }
  } finally {
    syncRunning = false
  }
}

router.post('/sync', async (req: Request, res: Response) => {
  await loadTokensFromDB()
  const connectedCompanies = Object.keys(COMPANIES).filter((key) => !!tokens[key])
  if (connectedCompanies.length === 0) {
    return res.status(401).json({ error: 'Nenhuma empresa conectada ao Bling.' })
  }

  const limite = req.body?.limite ? Number(req.body.limite) : undefined
  const onlyCompany = req.body?.company as string | undefined
  const result = await runBlingSync(limite, onlyCompany)
  res.json({ message: 'Sincronização concluída', ...result })
})

// GET /api/bling/sync-stream — SSE com progresso em tempo real
router.get('/sync-stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  if (syncRunning) {
    send('error', { message: 'Sincronização já em andamento. Aguarde e tente novamente.' })
    res.end()
    return
  }

  await loadTokensFromDB()
  const connectedCompanies = Object.keys(COMPANIES).filter((key) => !!tokens[key])
  if (connectedCompanies.length === 0) {
    send('error', { message: 'Nenhuma empresa conectada ao Bling.' })
    res.end()
    return
  }

  const onlyCompany = (req.query.company as string) || undefined

  // Heartbeat a cada 30s para evitar que o proxy do Railway corte a conexão
  // durante esperas longas (ex: retry de rate limit do Bling pode levar até 75s)
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000)

  try {
    const result = await runBlingSync(undefined, onlyCompany, (progress) => send('progress', progress))
    send('done', result)
  } catch (err) {
    send('error', { message: String(err) })
  } finally {
    clearInterval(heartbeat)
    res.end()
  }
})

// GET /api/bling/debug/nfe/:id - detalhes de uma NF específica
router.get('/debug/nfe/:id', async (req: Request, res: Response) => {
  const connectedCompanies = Object.keys(COMPANIES).filter((key) => !!tokens[key])
  if (connectedCompanies.length === 0) return res.status(401).json({ error: 'Não conectado' })
  try {
    const data = await blingGet(connectedCompanies[0], `/nfe/${req.params.id}`)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// GET /api/bling/debug/pedido/:id - detalhes de um pedido de venda específico
router.get('/debug/pedido/:id', async (req: Request, res: Response) => {
  const connectedCompanies = Object.keys(COMPANIES).filter((key) => !!tokens[key])
  if (connectedCompanies.length === 0) return res.status(401).json({ error: 'Não conectado' })
  try {
    const data = await blingGet(connectedCompanies[0], `/pedidos/vendas/${req.params.id}`)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// GET /api/bling/debug/lojas - lista as lojas/canais de venda do Bling
router.get('/debug/lojas', async (_req: Request, res: Response) => {
  const connected = Object.keys(COMPANIES).filter((key) => !!tokens[key])
  if (connected.length === 0) return res.status(401).json({ error: 'Não conectado' })
  const result: Record<string, unknown> = {}
  for (const companyKey of connected) {
    try {
      result[companyKey] = await blingGet(companyKey, '/lojas')
    } catch (err) {
      result[companyKey] = { error: String(err) }
    }
  }
  res.json(result)
})

// GET /api/bling/debug/find/:numero - acha NF por número paginando e retorna id+linkDanfe
router.get('/debug/find/:numero', async (req: Request, res: Response) => {
  const connected = Object.keys(COMPANIES).filter((key) => !!tokens[key])
  if (connected.length === 0) return res.status(401).json({ error: 'Não conectado' })
  const alvo = String(parseInt(req.params.numero, 10))
  const dataInicio = new Date(); dataInicio.setDate(dataInicio.getDate() - 365)
  const dataInicioStr = dataInicio.toISOString().slice(0, 10)
  for (const companyKey of connected) {
    let pagina = 1
    while (true) {
      const data = (await blingGet(companyKey, `/nfe?pagina=${pagina}&limite=100&dataEmissaoInicial=${dataInicioStr}`)) as BlingListResponse
      const nfes = data?.data ?? []
      if (nfes.length === 0) break
      const found = nfes.find(n => String(parseInt(String(n.numero), 10)) === alvo)
      if (found?.id) {
        const detail = (await blingGet(companyKey, `/nfe/${found.id}`)) as BlingNFeDetailResponse
        return res.json({ companyKey, id: found.id, numero: found.numero, linkDanfe: detail?.data?.linkDanfe ?? null, paginaEncontrada: pagina })
      }
      if (nfes.length < 100) break
      pagina++
    }
  }
  res.json({ error: 'NF não encontrada na paginação', alvo })
})

// GET /api/bling/debug - testa a API do Bling e retorna resposta bruta
router.get('/debug', async (_req: Request, res: Response) => {
  const connectedCompanies = Object.keys(COMPANIES).filter((key) => !!tokens[key])
  if (connectedCompanies.length === 0) {
    return res.status(401).json({ error: 'Nenhuma empresa conectada' })
  }

  const companyKey = connectedCompanies[0]
  const results: Record<string, unknown> = {}

  try {
    results['nfe'] = await blingGet(companyKey, '/nfe?pagina=1&limite=10')
  } catch (err) {
    results['nfe_error'] = axios.isAxiosError(err)
      ? { status: err.response?.status, data: err.response?.data }
      : String(err)
  }

  try {
    results['pedidos'] = await blingGet(companyKey, '/pedidos/vendas?pagina=1&limite=10')
  } catch (err) {
    results['pedidos_error'] = axios.isAxiosError(err)
      ? { status: err.response?.status, data: err.response?.data }
      : String(err)
  }

  res.json(results)
})

// POST /api/bling/enrich - preenche transportadora nos pedidos existentes sem carrier
router.post('/enrich', async (_req: Request, res: Response) => {
  const connectedCompanies = Object.keys(COMPANIES).filter((key) => !!tokens[key])
  if (connectedCompanies.length === 0) {
    return res.status(401).json({ error: 'Nenhuma empresa conectada ao Bling.' })
  }

  // Pedidos sem transportadora que têm número de NF
  const ordersWithoutCarrier = await prisma.order.findMany({
    where: { carrierId: null, nfNumber: { not: null } },
    select: { id: true, nfNumber: true, senderCnpj: true },
  })

  if (ordersWithoutCarrier.length === 0) {
    return res.json({ message: 'Nenhum pedido sem transportadora encontrado.', atualizados: 0 })
  }

  console.log(`[Enrich] ${ordersWithoutCarrier.length} pedidos sem transportadora`)

  // Monta mapa de nfNumber → blingId paginando todas as NFs do Bling
  const nfMap: Record<string, { blingId: number; companyKey: string }> = {}
  const nfNumbersNeeded = new Set(ordersWithoutCarrier.map((o) => String(o.nfNumber).replace(/^0+/, '')))

  const enrichDataInicio = new Date()
  enrichDataInicio.setDate(enrichDataInicio.getDate() - 90)
  const enrichDataInicioStr = enrichDataInicio.toISOString().slice(0, 10)

  for (const companyKey of connectedCompanies) {
    let pagina = 1
    while (true) {
      const data = (await blingGet(companyKey, `/nfe?pagina=${pagina}&limite=100&dataEmissaoInicial=${enrichDataInicioStr}`)) as BlingListResponse
      const nfes: BlingNFe[] = data?.data ?? []
      if (nfes.length === 0) break

      for (const nf of nfes) {
        const numSemZero = String(nf.numero).replace(/^0+/, '')
        if (nfNumbersNeeded.has(numSemZero)) {
          nfMap[numSemZero] = { blingId: nf.id, companyKey }
        }
      }

      if (nfes.length < 100) break
      pagina++
    }
    console.log(`[Enrich] ${companyKey}: mapeadas ${Object.keys(nfMap).length} NFs`)
  }

  let atualizados = 0
  let semDados = 0

  for (const order of ordersWithoutCarrier) {
    const numSemZero = String(order.nfNumber).replace(/^0+/, '')
    const entry = nfMap[numSemZero]
    if (!entry) { semDados++; continue }

    const resolved = await resolveCarrier(entry.companyKey, entry.blingId, String(order.nfNumber))
    if (!resolved) { semDados++; continue }

    await prisma.order.update({ where: { id: order.id }, data: { carrierId: resolved.carrierId, linkDanfe: resolved.linkDanfe } })
    atualizados++

    // Pausa para respeitar o rate limit do Bling
    await new Promise((r) => setTimeout(r, 600))
  }

  console.log(`[Enrich] Concluído: ${atualizados} atualizados, ${semDados} sem dados de transportadora`)
  res.json({ message: 'Enriquecimento concluído', atualizados, semDados })
})

// POST /api/bling/backfill-nf-values - preenche nfValue e nfIssuedAt nos pedidos existentes
// O valorNota não está na listagem — busca via /nfe/:id para cada pedido
// nfIssuedAt vem da listagem (dataEmissao) — salvo no mapa para evitar chamadas extras
router.post('/backfill-nf-values', async (_req: Request, res: Response) => {
  const connectedCompanies = Object.keys(COMPANIES).filter((key) => !!tokens[key])
  if (connectedCompanies.length === 0) {
    return res.status(401).json({ error: 'Nenhuma empresa conectada ao Bling.' })
  }

  const ordersToFill = await prisma.order.findMany({
    where: { OR: [{ nfValue: null }, { nfIssuedAt: null }], nfNumber: { not: null } },
    select: { id: true, nfNumber: true, senderCnpj: true },
  })

  if (ordersToFill.length === 0) {
    return res.json({ message: 'Todos os pedidos já têm valor e data de emissão preenchidos.', atualizados: 0 })
  }

  console.log(`[BackfillValues] ${ordersToFill.length} pedidos para preencher`)

  // Monta mapa nfNum|companyCnpj → { blingId, dataEmissao } paginando listagem
  const nfIdMap: Record<string, { blingId: number; companyKey: string; dataEmissao?: string }> = {}
  const nfNumbersNeeded = new Set(ordersToFill.map((o) => String(parseInt(o.nfNumber!, 10))))

  const dataInicio = new Date()
  dataInicio.setDate(dataInicio.getDate() - 365)
  const dataInicioStr = dataInicio.toISOString().slice(0, 10)

  for (const companyKey of connectedCompanies) {
    const company = COMPANIES[companyKey]
    let pagina = 1

    while (true) {
      try {
        const data = (await blingGet(companyKey, `/nfe?pagina=${pagina}&limite=100&dataEmissaoInicial=${dataInicioStr}`)) as BlingListResponse
        const nfes: BlingNFe[] = data?.data ?? []
        if (nfes.length === 0) break

        for (const nf of nfes) {
          const numSemZero = String(parseInt(String(nf.numero), 10))
          if (nfNumbersNeeded.has(numSemZero)) {
            nfIdMap[`${numSemZero}|${company.cnpj}`] = { blingId: nf.id, companyKey, dataEmissao: nf.dataEmissao }
          }
        }

        if (nfes.length < 100) break
        pagina++
        await new Promise((r) => setTimeout(r, 300))
      } catch (err) {
        console.error(`[BackfillValues] Erro ao listar NFs de ${companyKey}:`, err)
        break
      }
    }
    console.log(`[BackfillValues] ${company.name}: ${pagina} páginas escaneadas`)
  }

  console.log(`[BackfillValues] ${Object.keys(nfIdMap).length} NFs encontradas no Bling`)

  let atualizados = 0
  let semDados = 0

  for (const order of ordersToFill) {
    const nfNum = String(parseInt(order.nfNumber!, 10))
    const entry = nfIdMap[`${nfNum}|${order.senderCnpj}`]

    if (!entry) { semDados++; continue }

    try {
      const detail = (await blingGet(entry.companyKey, `/nfe/${entry.blingId}`)) as BlingNFeDetailResponse
      const detailData = detail?.data
      const valorNota = detailData?.valorNota
      const dataEmissaoRaw = entry.dataEmissao ?? detailData?.dataEmissao

      const updates: Record<string, unknown> = {}
      if (valorNota != null) updates.nfValue = valorNota
      if (dataEmissaoRaw) updates.nfIssuedAt = new Date(dataEmissaoRaw)

      if (Object.keys(updates).length === 0) { semDados++; continue }

      await prisma.order.update({ where: { id: order.id }, data: updates })
      console.log(`[BackfillValues] NF ${order.nfNumber}: R$ ${valorNota ?? '-'} | emissão: ${dataEmissaoRaw ?? '-'}`)
      atualizados++
      await new Promise((r) => setTimeout(r, 500))
    } catch (err) {
      console.error(`[BackfillValues] Erro ao buscar detalhe NF ${order.nfNumber}:`, err)
      semDados++
    }
  }

  console.log(`[BackfillValues] Concluído: ${atualizados} atualizados, ${semDados} sem dados`)
  res.json({ message: 'Backfill concluído', atualizados, semDados, total: ordersToFill.length })
})

// POST /api/bling/backfill-link-danfe - preenche linkDanfe nos pedidos sem o link
router.post('/backfill-link-danfe', async (req: Request, res: Response) => {
  const connectedCompanies = Object.keys(COMPANIES).filter((key) => !!tokens[key])
  if (connectedCompanies.length === 0) return res.status(401).json({ error: 'Nenhuma empresa conectada.' })

  const cnpjToKey: Record<string, string> = {}
  for (const [key, c] of Object.entries(COMPANIES)) cnpjToKey[c.cnpj] = key

  // Limite opcional via body para teste (ex: { orderNumber: "AVIC-NF-010566" })
  const orderNumber = (req.body as { orderNumber?: string }).orderNumber
  const where = orderNumber
    ? { orderNumber }
    : { linkDanfe: null, nfNumber: { not: null }, senderCnpj: { not: null } }

  const orders = await prisma.order.findMany({
    where, select: { id: true, nfNumber: true, senderCnpj: true, orderNumber: true },
    take: orderNumber ? 1 : 500,
  })
  if (orders.length === 0) return res.json({ message: 'Nada para preencher', atualizados: 0, semDados: 0, total: 0 })

  // Mapa numero→blingId paginando a listagem por empresa (mesmo método do backfill-recipient)
  const nfNumbersNeeded = new Set(orders.map(o => String(parseInt(o.nfNumber!, 10))))
  const idMap: Record<string, number> = {} // chave: `${numSemZero}|${cnpj}`
  const dataInicio = new Date(); dataInicio.setDate(dataInicio.getDate() - 365)
  const dataInicioStr = dataInicio.toISOString().slice(0, 10)

  for (const companyKey of connectedCompanies) {
    const company = COMPANIES[companyKey]
    let pagina = 1
    while (true) {
      try {
        const data = (await blingGet(companyKey, `/nfe?pagina=${pagina}&limite=100&dataEmissaoInicial=${dataInicioStr}`)) as BlingListResponse
        const nfes = data?.data ?? []
        if (nfes.length === 0) break
        for (const nf of nfes) {
          const num = String(parseInt(String(nf.numero), 10))
          if (nfNumbersNeeded.has(num) && nf.id) idMap[`${num}|${company.cnpj}`] = nf.id
        }
        if (nfes.length < 100) break
        pagina++
        await new Promise((r) => setTimeout(r, 300))
      } catch { break }
    }
  }

  let atualizados = 0, semDados = 0
  for (const order of orders) {
    const num = String(parseInt(order.nfNumber!, 10))
    const companyKey = order.senderCnpj ? cnpjToKey[order.senderCnpj] : undefined
    const blingId = idMap[`${num}|${order.senderCnpj}`]
    if (!companyKey || !blingId) { semDados++; continue }
    try {
      const detail = (await blingGet(companyKey, `/nfe/${blingId}`)) as BlingNFeDetailResponse
      const linkDanfe = detail?.data?.linkDanfe ?? null
      if (!linkDanfe) { semDados++; continue }
      await prisma.order.update({ where: { id: order.id }, data: { linkDanfe } })
      atualizados++
      await new Promise((r) => setTimeout(r, 400))
    } catch {
      semDados++
    }
  }

  res.json({ message: 'Backfill linkDanfe concluído', atualizados, semDados, total: orders.length })
})

// POST /api/bling/backfill-recipient-cnpj - preenche recipientCnpj nos pedidos existentes
// destinatario.numeroDocumento já vem na listagem — sem chamadas extras
router.post('/backfill-recipient-cnpj', async (_req: Request, res: Response) => {
  const connectedCompanies = Object.keys(COMPANIES).filter((key) => !!tokens[key])
  if (connectedCompanies.length === 0) {
    return res.status(401).json({ error: 'Nenhuma empresa conectada ao Bling.' })
  }

  const ordersToFill = await prisma.order.findMany({
    where: { recipientCnpj: null, nfNumber: { not: null } },
    select: { id: true, nfNumber: true, senderCnpj: true },
  })

  if (ordersToFill.length === 0) {
    return res.json({ message: 'Todos os pedidos já têm recipientCnpj preenchido.', atualizados: 0 })
  }

  console.log(`[BackfillRecipient] ${ordersToFill.length} pedidos para preencher`)

  // Mapa nfNum|senderCnpj → recipientCnpj (digits only)
  const cnpjMap: Record<string, string> = {}
  const nfNumbersNeeded = new Set(ordersToFill.map((o) => String(parseInt(o.nfNumber!, 10))))

  const dataInicio = new Date()
  dataInicio.setDate(dataInicio.getDate() - 365)
  const dataInicioStr = dataInicio.toISOString().slice(0, 10)

  for (const companyKey of connectedCompanies) {
    const company = COMPANIES[companyKey]
    let pagina = 1
    while (true) {
      try {
        const data = (await blingGet(companyKey, `/nfe?pagina=${pagina}&limite=100&dataEmissaoInicial=${dataInicioStr}`)) as BlingListResponse
        const nfes: BlingNFe[] = data?.data ?? []
        if (nfes.length === 0) break
        for (const nf of nfes) {
          const numSemZero = String(parseInt(String(nf.numero), 10))
          const docRaw = (nf.contato?.numeroDocumento ?? nf.destinatario?.numeroDocumento)?.replace(/\D/g, '')
          if (nfNumbersNeeded.has(numSemZero) && docRaw) {
            cnpjMap[`${numSemZero}|${company.cnpj}`] = docRaw
          }
        }
        if (nfes.length < 100) break
        pagina++
        await new Promise((r) => setTimeout(r, 300))
      } catch (err) {
        console.error(`[BackfillRecipient] Erro ao listar NFs de ${companyKey}:`, err)
        break
      }
    }
    console.log(`[BackfillRecipient] ${company.name}: ${pagina} páginas escaneadas`)
  }

  console.log(`[BackfillRecipient] ${Object.keys(cnpjMap).length} NFs com destinatário encontradas`)

  let atualizados = 0
  let semDados = 0

  for (const order of ordersToFill) {
    const key = `${String(parseInt(order.nfNumber!, 10))}|${order.senderCnpj}`
    const recipientCnpj = cnpjMap[key]
    if (!recipientCnpj) { semDados++; continue }
    await prisma.order.update({ where: { id: order.id }, data: { recipientCnpj } })
    atualizados++
  }

  console.log(`[BackfillRecipient] Concluído: ${atualizados} atualizados, ${semDados} sem dados`)
  res.json({ message: 'Backfill concluído', atualizados, semDados, total: ordersToFill.length })
})

// POST /api/bling/disconnect/:company - desconecta uma empresa
router.post('/disconnect/:company', async (req: Request, res: Response) => {
  await deleteToken(req.params.company)
  res.json({ message: 'Desconectado' })
})

interface BlingNFe {
  id: number
  numero: number
  valor?: number
  dataEmissao?: string
  contato?: { nome?: string; email?: string; telefone?: string; numeroDocumento?: string }
  destinatario?: { numeroDocumento?: string; nome?: string }
  transportador?: { nome?: string; cpfCnpj?: string }
}

interface BlingListResponse {
  data?: BlingNFe[]
}

interface BlingNFeDetailResponse {
  data?: {
    transporte?: {
      transportador?: { numeroDocumento?: string; nome?: string }
    }
    valorNota?: number
    dataEmissao?: string
    linkDanfe?: string
    linkPDF?: string
  }
}

// POST /api/bling/cleanup-none-carriers
// Remove pedidos PENDING com transportadoras sem API (trackingSystem=NONE) e sem eventos de rastreio
router.post('/cleanup-none-carriers', async (_req: Request, res: Response) => {
  const { TrackingSystem } = await import('@prisma/client')
  const pedidos = await prisma.order.findMany({
    where: {
      status: 'PENDING',
      lastTracking: null,
      carrier: { trackingSystem: TrackingSystem.NONE },
    },
    select: { id: true, orderNumber: true },
  })

  if (pedidos.length === 0) return res.json({ message: 'Nenhum pedido para limpar.', removidos: 0 })

  const ids = pedidos.map(p => p.id)
  await prisma.order.deleteMany({ where: { id: { in: ids } } })

  console.log(`[Cleanup] ${pedidos.length} pedidos PENDING sem rastreio removidos (carriers NONE)`)
  res.json({ message: 'Limpeza concluída', removidos: pedidos.length, exemplos: pedidos.slice(0, 5).map(p => p.orderNumber) })
})

// POST /api/bling/mark-old-pending-delivered
// Marca como DELIVERED pedidos PENDING sem rastreio emitidos antes de uma data de corte
router.post('/mark-old-pending-delivered', async (req: Request, res: Response) => {
  const cutoffStr = (req.body as { cutoff?: string }).cutoff ?? '2026-04-01'
  const cutoff = new Date(cutoffStr)

  const orders = await prisma.order.findMany({
    where: {
      status: 'PENDING',
      lastTracking: null,
      shippedAt: null,
      nfIssuedAt: { lt: cutoff },
    },
    select: { id: true, orderNumber: true, nfIssuedAt: true },
  })

  if (orders.length === 0) return res.json({ message: 'Nenhum pedido para marcar.', marcados: 0 })

  for (const order of orders) {
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
        lastTracking: 'Marcado como entregue (NF antiga sem dados de rastreio disponíveis)',
        statusHistory: {
          create: { status: 'DELIVERED', note: `NF emitida em ${order.nfIssuedAt?.toLocaleDateString('pt-BR')} — marcada automaticamente após 60+ dias sem rastreio` }
        }
      }
    })
  }

  console.log(`[Admin] ${orders.length} pedidos antigos marcados como ENTREGUE (corte: ${cutoffStr})`)
  res.json({ message: 'Concluído', marcados: orders.length, cutoff: cutoffStr, exemplos: orders.slice(0, 5).map(o => o.orderNumber) })
})

export { publicRouter as blingPublicRouter }
export default router
