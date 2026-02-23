import { Router, Request, Response } from 'express'
import axios from 'axios'
import { prisma } from '../lib/prisma'

const router = Router()

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

// Tokens em memória por empresa
const tokens: Record<string, { access_token: string; refresh_token: string }> = {}

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
      const nfeData = await blingGet(companyKey, '/nfe?pagina=1&limite=100&situacao=9')
      const nfes: BlingNFe[] = nfeData?.data ?? []

      for (const nf of nfes) {
        const existing = await prisma.order.findFirst({
          where: { nfNumber: String(nf.numero) },
        })

        if (existing) { ignorados++; continue }

        const transportadoraNome = nf.transportador?.nome ?? ''
        let carrier = localCarriers.find((c) =>
          c.name.toLowerCase().includes(transportadoraNome.toLowerCase()) ||
          transportadoraNome.toLowerCase().includes(c.name.toLowerCase())
        ) ?? localCarriers[0]

        if (!carrier) { ignorados++; continue }

        await prisma.order.create({
          data: {
            orderNumber: `NF-${nf.numero}`,
            customerName: nf.contato?.nome ?? 'Cliente não informado',
            carrierId: carrier.id,
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

// POST /api/bling/disconnect/:company - desconecta uma empresa
router.post('/disconnect/:company', (req: Request, res: Response) => {
  delete tokens[req.params.company]
  res.json({ message: 'Desconectado' })
})

interface BlingNFe {
  numero: number
  contato?: { nome?: string }
  transportador?: { nome?: string }
}

export default router
