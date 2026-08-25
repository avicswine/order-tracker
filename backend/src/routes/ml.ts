import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { mlAuthUrl, mlExchangeCode, mlStatus, syncMlClaims, ML_COMPANIES, type MlCompany } from '../services/mercadolivre'

// Rotas autenticadas (montadas com requireAuth)
const router = Router()

// Estados OAuth pendentes: state → { company, expiresAt } (anti-CSRF, validade 10 min)
const pendingStates = new Map<string, { company: MlCompany; expiresAt: number }>()

function cleanExpiredStates() {
  const now = Date.now()
  for (const [state, info] of pendingStates) {
    if (info.expiresAt < now) pendingStates.delete(state)
  }
}

// GET /ml/status — situação da integração por empresa
router.get('/status', async (_req: Request, res: Response) => {
  res.json(await mlStatus())
})

// GET /ml/auth/:company — devolve a URL de autorização no ML
router.get('/auth/:company', (req: Request, res: Response) => {
  const company = req.params.company as MlCompany
  if (!ML_COMPANIES.includes(company)) return res.status(400).json({ error: 'Empresa inválida' })

  cleanExpiredStates()
  const state = `${company}:${crypto.randomBytes(16).toString('hex')}`
  pendingStates.set(state, { company, expiresAt: Date.now() + 10 * 60 * 1000 })

  const url = mlAuthUrl(company, state)
  if (!url) return res.status(400).json({ error: `Credenciais ML de ${company.toUpperCase()} não configuradas (env)` })
  res.json({ url })
})

// POST /ml/sync — sincroniza reclamações agora
router.post('/sync', async (_req: Request, res: Response) => {
  const result = await syncMlClaims()
  res.json(result)
})

// Router público — callback do OAuth (o navegador chega sem nosso JWT)
export const mlPublicRouter = Router()

mlPublicRouter.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined
  const state = req.query.state as string | undefined

  const known = state ? pendingStates.get(state) : undefined
  if (!code || !known) {
    return res.status(400).send('<h3>Autorização inválida ou expirada. Tente novamente pelo painel.</h3>')
  }
  pendingStates.delete(state as string)

  try {
    await mlExchangeCode(known.company, code)
    res.send(`<h3>✅ Mercado Livre autorizado para ${known.company.toUpperCase()}. Pode fechar esta aba.</h3>`)
  } catch (err) {
    console.error('[ML] Erro no callback OAuth:', err)
    res.status(500).send('<h3>Erro ao concluir a autorização. Veja os logs.</h3>')
  }
})

export default router
