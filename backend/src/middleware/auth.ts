import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

// Financeiro (pagamento das guias): só o DIFAL e o "quem sou eu" do login. Caminho escrito de outro jeito
// (maiúsculas etc.) cai no 403, que é o lado seguro. A configuração dos estados, dentro do DIFAL, é barrada
// rota a rota com negarAoFinanceiro.
const ROTAS_DO_FINANCEIRO = /^\/api\/(difal\/|auth\/me$)/

export interface AuthPayload {
  id: string
  role: 'ADMIN' | 'VIEWER' | 'FINANCEIRO'
}

function financeiroPode(req: Request): boolean {
  return ROTAS_DO_FINANCEIRO.test(req.originalUrl.split('?')[0])
}

/** Na própria rota (vale qualquer que seja a grafia do caminho): o Financeiro não mexe na configuração. */
export function negarAoFinanceiro(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === 'FINANCEIRO') return res.status(403).json({ error: 'Acesso negado: permissão insuficiente' })
  next()
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
