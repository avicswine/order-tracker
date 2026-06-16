import { Router, Request, Response } from 'express'
import { body, validationResult } from 'express-validator'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'

const router = Router()

// Rate limit no login — 10 tentativas por IP a cada 15 min (anti brute-force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
})

// POST /api/auth/login
router.post(
  '/login',
  loginLimiter,
  [
    body('email').isEmail().trim().toLowerCase(),
    body('password').notEmpty(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const { email, password } = req.body

    try {
      const user = await prisma.user.findUnique({ where: { email } })
      if (!user || !user.active) {
        return res.status(401).json({ error: 'Email ou senha inválidos' })
      }

      const valid = await bcrypt.compare(password, user.password)
      if (!valid) {
        return res.status(401).json({ error: 'Email ou senha inválidos' })
      }

      const token = jwt.sign(
        { id: user.id, role: user.role },
        process.env.JWT_SECRET as string,
        { expiresIn: '7d' }
      )

      res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } })
    } catch {
      res.status(500).json({ error: 'Erro interno ao realizar login' })
    }
  }
)

// GET /api/auth/me
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' })
  res.json(user)
})

// PATCH /api/auth/reset-password — altera senha de qualquer usuário (só ADMIN)
router.patch('/reset-password', requireAuth, [
  body('email').isEmail(),
  body('newPassword').isLength({ min: 6 }),
], async (req: Request, res: Response) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Apenas admin' })
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { email, newPassword } = req.body as { email: string; newPassword: string }
  const hashed = await bcrypt.hash(newPassword, 12)
  const user = await prisma.user.upsert({
    where: { email },
    update: { password: hashed, active: true },
    create: { name: email.split('@')[0], email, password: hashed, role: 'VIEWER', active: true },
    select: { id: true, name: true, email: true, role: true },
  })
  res.json({ ok: true, user })
})

// PATCH /api/auth/set-role — altera o papel de um usuário (só ADMIN)
router.patch('/set-role', requireAuth, [
  body('email').isEmail(),
  body('role').isIn(['ADMIN', 'VIEWER']),
], async (req: Request, res: Response) => {
  if (req.user?.role !== 'ADMIN') return res.status(403).json({ error: 'Apenas admin' })
  const errors = validationResult(req)
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

  const { email, role } = req.body as { email: string; role: 'ADMIN' | 'VIEWER' }
  const user = await prisma.user.update({
    where: { email },
    data: { role },
    select: { id: true, name: true, email: true, role: true },
  })
  res.json({ ok: true, user })
})

export default router
