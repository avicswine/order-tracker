import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

// Financeiro (pagamento das guias): só o DIFAL e o "quem sou eu" do login.
// Fica de fora a configuração dos estados (alíquotas, campos da GNRE no portal, rotina diária).
const ROTAS_DO_FINANCEIRO = /^\/api\/(difal\/|auth\/me$)/
const CONFIG_DO_DIFAL = /^\/api\/difal\/(aliquotas\/|portal\/config\/|rotina\/)/

export interface AuthPayload {
  id: string
  role: 'ADMIN' | 'VIEWER' | 'FINANCEIRO'
}

function financeiroPode(req: Request): boolean {
  const caminho = req.originalUrl.split('?')[0]
  if (!ROTAS_DO_FINANCEIRO.test(caminho)) return false
  // a lista de alíquotas pode ser lida (a tela usa); mudar a configuração, não
  return !CONFIG_DO_DIFAL.test(caminho) || (req.method === 'GET' && caminho.startsWith('/api/difal/aliquotas'))
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthPayload
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  // Fallback: token via query string (usado por SSE, que não suporta headers customizados)
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined)

  if (!token) {
    return res.status(401).json({ error: 'Token não informado' })
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload
    req.user = payload
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }

  if (req.user.role === 'VIEWER' && WRITE_METHODS.includes(req.method)) {
    return res.status(403).json({ error: 'Acesso negado: permissão insuficiente' })
  }
  if (req.user.role === 'FINANCEIRO' && !financeiroPode(req)) {
    return res.status(403).json({ error: 'Acesso negado: permissão insuficiente' })
  }

  next()
}
