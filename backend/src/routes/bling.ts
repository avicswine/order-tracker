import { Router, Request, Response } from 'express'
import axios from 'axios'
import { prisma } from '../lib/prisma'

const router = Router()
const publicRouter = Router()

// Cache em memória — populado do banco na inicialização via loadTokensFromDB()
const tokens: Record<string, { access_token: string; refresh_token: string }> = {}

// Lock para evitar syncs paralelos (ex: múltiplos restarts do Railway)
let syncRunning = false

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

// Busca e vincula transportadora de uma NF pelo ID interno do Bling
async function resolveCarrier(companyKey: string, nfId: number, nfNumero: string): Promise<string | undefined> {
  try {
    const detail = (await blingGet(companyKey, `/nfe/${nfId}`)) as BlingNFeDetailResponse
    const transportador = detail?.data?.transporte?.transportador
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
      console.log(`[Bling] NF ${nfNumero}: transportadora "${transportador.nome}" vinculada a "${existing.name}"`)
      return existing.id
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
        console.log(`[Bling] NF ${nfNumero}: transportadora "${transportador.nome}" vinculada pelo nome (CNPJ diferente: ${cnpjNormalizado})`)
        return existingByName.id
      }

      try {
        // Cria sempre com CNPJ normalizado (só dígitos)
        const created = await prisma.carrier.create({
          data: { name: transportador.nome, cnpj: cnpjNormalizado, phone: '' },
        })
        console.log(`[Bling] NF ${nfNumero}: transportadora "${transportador.nome}" criada automaticamente`)
        return created.id
      } catch (createErr: unknown) {
        // Se outra requisição concorrente já criou, busca e retorna
        if (createErr instanceof Error && 'code' in createErr && (createErr as { code: string }).code === 'P2002') {
          const found = await prisma.carrier.findFirst({
            where: { OR: [{ cnpj: cnpjNormalizado }, { cnpj: cnpjRaw }] },
          })
          return found?.id
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
export async function runBlingSync(limite?: number, onlyCompany?: string) {
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
        select: { id: true, nfNumber: true, customerPhone: true },
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
            // Preenche customerPhone se ainda não está salvo
            const phone = nf.contato?.telefone?.replace(/\D/g, '') || null
            if (phone && !existing.customerPhone) {
              await prisma.order.update({ where: { id: existing.id }, data: { customerPhone: phone } })
            }
            ignorados++
            continue
          }

          await new Promise((r) => setTimeout(r, 1000)) // 1s entre cada NF para evitar rate limit
          const carrierId = await resolveCarrier(companyKey, nf.id, String(nf.numero))

          // Sem transportadora rastreável → ignora (ex: Mercado Envios, sem transporte)
          if (!carrierId) { ignorados++; continue }

          await prisma.order.create({
            data: {
              orderNumber: `${company.code}-NF-${nf.numero}`,
              customerName: nf.contato?.nome ?? 'Cliente não informado',
              customerEmail: nf.contato?.email ?? null,
              customerPhone: nf.contato?.telefone?.replace(/\D/g, '') || null,
              nfNumber: String(nf.numero),
              nfValue: nf.valor ?? null,
              nfIssuedAt: nf.dataEmissao ? new Date(nf.dataEmissao) : null,
              senderCnpj: company.cnpj,
              recipientCnpj: nf.destinatario?.numeroDocumento?.replace(/\D/g, '') ?? null,
              carrierId,
              statusHistory: { create: { status: 'PENDING', note: `Importado do Bling (${company.name})` } },
            },
          })

          criados++
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

    const carrierId = await resolveCarrier(entry.companyKey, entry.blingId, String(order.nfNumber))
    if (!carrierId) { semDados++; continue }

    await prisma.order.update({ where: { id: order.id }, data: { carrierId } })
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
          const docRaw = nf.destinatario?.numeroDocumento?.replace(/\D/g, '')
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
  contato?: { nome?: string; email?: string; telefone?: string }
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
  }
}

export { publicRouter as blingPublicRouter }
export default router
