import { Router, Request, Response } from 'express'
import axios from 'axios'
import { prisma } from '../lib/prisma'
import fs from 'fs'
import path from 'path'

const router = Router()

const TOKENS_FILE = path.join(__dirname, '../../.bling-tokens.json')

function loadTokens(): Record<string, { access_token: string; refresh_token: string }> {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'))
    }
  } catch {}
  return {}
}

function saveTokens() {
  try {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2))
  } catch {}
}

const BLING_REDIRECT_URI = process.env.BLING_REDIRECT_URI!
const BLING_API = 'https://api.bling.com.br/Api/v3'
const BLING_AUTH_URL = 'https://www.bling.com.br/Api/v3/oauth/authorize'
const BLING_TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token'

// Configuração das 3 empresas
const COMPANIES: Record<string, { name: string; cnpj: string; clientId: string; clientSecret: string }> = {
  avic: {
    name: 'Avic',
    cnpj: '47.715.256/0001-49',
    clientId: process.env.BLING_AVIC_CLIENT_ID!,
    clientSecret: process.env.BLING_AVIC_CLIENT_SECRET!,
  },
  agrogranja: {
    name: 'Agrogranja',
    cnpj: '54.695.386/0001-22',
    clientId: process.env.BLING_AGROGRANJA_CLIENT_ID!,
    clientSecret: process.env.BLING_AGROGRANJA_CLIENT_SECRET!,
  },
  equipage: {
    name: 'Equipage',
    cnpj: '56.633.474/0001-25',
    clientId: process.env.BLING_EQUIPAGE_CLIENT_ID!,
    clientSecret: process.env.BLING_EQUIPAGE_CLIENT_SECRET!,
  },
}

// Tokens persistidos em arquivo por empresa
const tokens: Record<string, { access_token: string; refresh_token: string }> = loadTokens()

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

// GET /api/bling/auth/:company - inicia OAuth para a empresa
router.get('/auth/:company', (req: Request, res: Response) => {
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

// GET /api/bling/callback - recebe código e identifica empresa pelo state
router.get('/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query
  const companyKey = state as string
  const company = COMPANIES[companyKey]

  if (!code || !company) {
    return res.redirect('http://localhost:5173?bling=error')
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
    saveTokens()

    res.redirect(`http://localhost:5173?bling=connected&company=${companyKey}`)
  } catch (err) {
    console.error(`Erro ao autenticar ${companyKey}:`, err)
    res.redirect('http://localhost:5173?bling=error')
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
  saveTokens()
}

// Chamada autenticada ao Bling por empresa (com retry em 401 e 429)
async function blingGet(companyKey: string, path: string, retries = 3): Promise<unknown> {
  const token = tokens[companyKey]
  if (!token) throw new Error(`Empresa ${companyKey} não conectada`)

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
        const wait = (4 - retries) * 2000 // 2s, 4s, 6s
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
    const detail = await blingGet(companyKey, `/nfe/${nfId}`)
    const transportador = detail?.data?.transporte?.transportador
    if (!transportador?.numeroDocumento) return undefined

    const cnpjRaw = transportador.numeroDocumento
    const cnpjNormalizado = cnpjRaw.replace(/\D/g, '')

    // Busca por CNPJ normalizado (só dígitos) ou pelo valor exato do Bling
    const existing = await prisma.carrier.findFirst({
      where: { OR: [{ cnpj: cnpjNormalizado }, { cnpj: cnpjRaw }] },
    })
    if (existing) {
      console.log(`[Bling] NF ${nfNumero}: transportadora "${transportador.nome}" vinculada a "${existing.name}"`)
      return existing.id
    }
    if (transportador.nome) {
      // Ignora envios do Mercado Livre — não há rastreio disponível
      if (/mercado/i.test(transportador.nome)) {
        console.log(`[Bling] NF ${nfNumero}: Mercado Envios — ignorada`)
        return undefined
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
router.post('/sync', async (_req: Request, res: Response) => {
  const connectedCompanies = Object.keys(COMPANIES).filter((key) => !!tokens[key])

  if (connectedCompanies.length === 0) {
    return res.status(401).json({ error: 'Nenhuma empresa conectada ao Bling.' })
  }

  const localCarriers = await prisma.carrier.findMany({ where: { active: true } })

  const results: Record<string, { criados: number; ignorados: number }> = {}

  for (const companyKey of connectedCompanies) {
    const company = COMPANIES[companyKey]
    let criados = 0
    let ignorados = 0

    try {
      // Importa apenas NFs dos últimos 90 dias
      const dataInicio = new Date()
      dataInicio.setDate(dataInicio.getDate() - 90)
      const dataInicioStr = dataInicio.toISOString().slice(0, 10)
      const nfeData = await blingGet(companyKey, `/nfe?pagina=1&limite=100&dataEmissaoInicial=${dataInicioStr}`)
      console.log(`[Bling] ${company.name} resposta:`, JSON.stringify(nfeData).slice(0, 500))
      const nfes: BlingNFe[] = nfeData?.data ?? []
      console.log(`[Bling] ${company.name}: ${nfes.length} NFs encontradas`)

      for (const nf of nfes) {
        const existing = await prisma.order.findFirst({
          where: { nfNumber: String(nf.numero) },
        })

        if (existing) { ignorados++; continue }

        const carrierId = await resolveCarrier(companyKey, nf.id, nf.numero)

        // Sem transportadora rastreável → ignora (ex: Mercado Envios, sem transporte)
        if (!carrierId) { ignorados++; continue }

        await prisma.order.create({
          data: {
            orderNumber: `NF-${nf.numero}`,
            customerName: nf.contato?.nome ?? 'Cliente não informado',
            customerEmail: nf.contato?.email ?? null,
            nfNumber: String(nf.numero),
            senderCnpj: company.cnpj,
            recipientCnpj: nf.destinatario?.numeroDocumento?.replace(/\D/g, '') ?? null,
            carrierId,
            statusHistory: { create: { status: 'PENDING', note: `Importado do Bling (${company.name})` } },
          },
        })

        criados++
      }
    } catch (err) {
      console.error(`Erro ao sincronizar ${companyKey}:`, err)
    }

    results[companyKey] = { criados, ignorados }
  }

  const totalCriados = Object.values(results).reduce((s, r) => s + r.criados, 0)
  const totalIgnorados = Object.values(results).reduce((s, r) => s + r.ignorados, 0)

  res.json({ message: 'Sincronização concluída', results, totalCriados, totalIgnorados })
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
      const data = await blingGet(companyKey, `/nfe?pagina=${pagina}&limite=100&dataEmissaoInicial=${enrichDataInicioStr}`)
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

// POST /api/bling/disconnect/:company - desconecta uma empresa
router.post('/disconnect/:company', (req: Request, res: Response) => {
  delete tokens[req.params.company]
  saveTokens()
  res.json({ message: 'Desconectado' })
})

interface BlingNFe {
  id: number
  numero: number
  contato?: { nome?: string; email?: string }
  destinatario?: { numeroDocumento?: string; nome?: string }
  transportador?: { nome?: string; cpfCnpj?: string }
}

export default router
