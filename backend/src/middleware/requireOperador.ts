import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

// Auth do módulo de separação — independente do login do painel (users).
// O token é emitido em POST /api/separacao/auth/login e carrega kind = 'operador'
// para nunca ser aceito pelo requireAuth do painel (e vice-versa).
export interface OperadorPayload {
  kind: 'operador'
  id: string
  nome: string
  supervisor: boolean
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      operador?: OperadorPayload
    }
  }
}

function extrairToken(req: Request): string | undefined {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  // Fallback para SSE (EventSource não envia headers customizados)
  return req.query.token as string | undefined
}

export function requireOperador(req: Request, res: Response, next: NextFunction) {
  const token = extrairToken(req)
  if (!token) return res.status(401).json({ error: 'Token não informado' })

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as Partial<OperadorPayload>
    if (payload.kind !== 'operador' || !payload.id) {
      return res.status(401).json({ error: 'Token inválido para o módulo de separação' })
    }
    req.operador = payload as OperadorPayload
    next()
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }
}

// Só supervisores: triagem, finalizar no balcão, liberar exceções, gerir operadores e config
export function requireSupervisor(req: Request, res: Response, next: NextFunction) {
  if (!req.operador?.supervisor) {
    return res.status(403).json({ error: 'Apenas supervisores podem fazer isso' })
  }
  next()
}
