import { Router, Request, Response } from 'express'
import axios from 'axios'
import { prisma } from '../lib/prisma'

const router = Router()

const BLING_CLIENT_ID = process.env.BLING_CLIENT_ID!
const BLING_CLIENT_SECRET = process.env.BLING_CLIENT_SECRET!
const BLING_REDIRECT_URI = process.env.BLING_REDIRECT_URI!
const BLING_API = 'https://api.bling.com.br/Api/v3'
const BLING_AUTH_URL = 'https://www.bling.com.br/Api/v3/oauth/authorize'
const BLING_TOKEN_URL = 'https://www.bling.com.br/Api/v3/oauth/token'

// CNPJ da Avic (empresa padrão para esta integração)
const AVIC_CNPJ = '47.715.256/0001-49'

// Armazena tokens em memória (simples para uso local)
let blingTokens: { access_token: string; refresh_token: string } | null = null

// GET /api/bling/status - verifica se está conectado
router.get('/status', (_req: Request, res: Response) => {
  res.json({ connected: !!blingTokens })
})

// GET /api/bling/auth - inicia o fluxo OAuth
router.get('/auth', (_req: Request, res: Response) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: BLING_CLIENT_ID,
    redirect_uri: BLING_REDIRECT_URI,
    state: 'order-tracker',
  })
  res.redirect(`${BLING_AUTH_URL}?${params.toString()}`)
})

// GET /api/bling/callback - recebe o código e troca pelo token
router.get('/callback', async (req: Request, res: Response) => {
  const { code } = req.query

  if (!code) {
    return res.status(400).send('Código de autorização não recebido.')
  }

  try {
    const credentials = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64')

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

    blingTokens = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
    }

    // Redireciona de volta ao frontend com sucesso
    res.redirect('http://localhost:5173?bling=connected')
  } catch (err) {
    console.error('Erro ao trocar token Bling:', err)
    res.redirect('http://localhost:5173?bling=error')
  }
})

// Função auxiliar para renovar token
async function refreshAccessToken() {
  if (!blingTokens?.refresh_token) throw new Error('Sem refresh token')

  const credentials = Buffer.from(`${BLING_CLIENT_ID}:${BLING_CLIENT_SECRET}`).toString('base64')

  const response = await axios.post(
    BLING_TOKEN_URL,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: blingTokens.refresh_token,
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
    }
  )

  blingTokens = {
    access_token: response.data.access_token,
    refresh_token: response.data.refresh_token,
  }
}

// Função auxiliar para chamadas autenticadas ao Bling
async function blingGet(path: string) {
  if (!blingTokens) throw new Error('Não conectado ao Bling')

  try {
    const response = await axios.get(`${BLING_API}${path}`, {
      headers: { Authorization: `Bearer ${blingTokens.access_token}` },
    })
    return response.data
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      await refreshAccessToken()
      const response = await axios.get(`${BLING_API}${path}`, {
        headers: { Authorization: `Bearer ${blingTokens!.access_token}` },
      })
      return response.data
    }
    throw err
  }
}

// POST /api/bling/sync - importa NFs do Bling para o Order Tracker
router.post('/sync', async (_req: Request, res: Response) => {
  if (!blingTokens) {
    return res.status(401).json({ error: 'Não conectado ao Bling. Autorize primeiro.' })
  }

  try {
    // Buscar transportadoras cadastradas localmente
    const localCarriers = await prisma.carrier.findMany({ where: { active: true } })

    // Buscar NF-e do Bling (página 1, até 100 registros)
    const nfeData = await blingGet('/nfe?pagina=1&limite=100&situacao=9') // situação 9 = autorizada
    const nfes: BlingNFe[] = nfeData?.data ?? []

    let criados = 0
    let ignorados = 0

    for (const nf of nfes) {
      // Verificar se já existe pelo número da NF
      const existing = await prisma.order.findFirst({
        where: { nfNumber: String(nf.numero) },
      })

      if (existing) {
        ignorados++
        continue
      }

      // Tentar encontrar transportadora local pelo nome
      const transportadoraNome = nf.transportador?.nome ?? ''
      let carrier = localCarriers.find((c) =>
        c.name.toLowerCase().includes(transportadoraNome.toLowerCase()) ||
        transportadoraNome.toLowerCase().includes(c.name.toLowerCase())
      )

      // Se não encontrar, usar a primeira transportadora ativa como fallback
      if (!carrier) carrier = localCarriers[0]
      if (!carrier) {
        ignorados++
        continue
      }

      await prisma.order.create({
        data: {
          orderNumber: `NF-${nf.numero}`,
          customerName: nf.contato?.nome ?? 'Cliente não informado',
          carrierId: carrier.id,
          nfNumber: String(nf.numero),
          senderCnpj: AVIC_CNPJ,
          statusHistory: { create: { status: 'PENDING', note: 'Importado do Bling' } },
        },
      })

      criados++
    }

    res.json({
      message: `Sincronização concluída`,
      criados,
      ignorados,
      total: nfes.length,
    })
  } catch (err) {
    console.error('Erro ao sincronizar com Bling:', err)
    res.status(500).json({ error: 'Erro ao sincronizar com o Bling' })
  }
})

// POST /api/bling/disconnect - desconecta
router.post('/disconnect', (_req: Request, res: Response) => {
  blingTokens = null
  res.json({ message: 'Desconectado do Bling' })
})

interface BlingNFe {
  numero: number
  contato?: { nome?: string }
  transportador?: { nome?: string }
}

export default router
