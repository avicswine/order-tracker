import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

export interface AuthPayload {
  id: string
  role: 'ADMIN' | 'VIEWER'
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
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não informado' })
  }

  const token = header.slice(7)
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthPayload
    req.user = payload
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }

  if (req.user.role === 'VIEWER' && WRITE_METHODS.includes(req.method)) {
    return res.status(403).json({ error: 'Acesso negado: permissão insuficiente' })
  }

  next()
}
