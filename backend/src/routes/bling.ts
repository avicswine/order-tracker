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

// Chamada autenticada ao Bling por empresa
async function blingGet(companyKey: string, path: string) {
  const token = tokens[companyKey]
  if (!token) throw new Error(`Empresa ${companyKey} não conectada`)

  try {
    const response = await axios.get(`${BLING_API}${path}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    return response.data
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      await refreshToken(companyKey)
      const response = await axios.get(`${BLING_API}${path}`, {
        headers: { Authorization: `Bearer ${tokens[companyKey].access_token}` },
      })
      return response.data
    }
    throw err
  }
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
      // situacao=6 = Autorizada | sem filtro = todas
      const nfeData = await blingGet(companyKey, '/nfe?pagina=1&limite=100')
      console.log(`[Bling] ${company.name} resposta:`, JSON.stringify(nfeData).slice(0, 500))
      const nfes: BlingNFe[] = nfeData?.data ?? []
      console.log(`[Bling] ${company.name}: ${nfes.length} NFs encontradas`)

      for (const nf of nfes) {
        const existing = await prisma.order.findFirst({
          where: { nfNumber: String(nf.numero) },
        })

        if (existing) { ignorados++; continue }

        await prisma.order.create({
          data: {
            orderNumber: `NF-${nf.numero}`,
            customerName: nf.contato?.nome ?? 'Cliente não informado',
            nfNumber: String(nf.numero),
            senderCnpj: company.cnpj,
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

// POST /api/bling/disconnect/:company - desconecta uma empresa
router.post('/disconnect/:company', (req: Request, res: Response) => {
  delete tokens[req.params.company]
  saveTokens()
  res.json({ message: 'Desconectado' })
})

interface BlingNFe {
  numero: number
  contato?: { nome?: string }
  transportador?: { nome?: string }
}

export default router
