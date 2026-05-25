import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'

const router = Router()

// Endpoint temporário para reset de admin — remover após uso
const SETUP_SECRET = 'avic-setup-2026-x9k'

router.post('/reset-admin', async (req: Request, res: Response) => {
  const { secret, password } = req.body
  if (secret !== SETUP_SECRET) return res.status(403).json({ error: 'Proibido' })
  if (!password) return res.status(400).json({ error: 'Senha obrigatória' })

  try {
    const hashed = await bcrypt.hash(password, 12)
    const user = await prisma.user.upsert({
      where: { email: 'admin@avicswine.com.br' },
      update: { password: hashed, active: true },
      create: { name: 'Admin', email: 'admin@avicswine.com.br', password: hashed, role: 'ADMIN', active: true },
      select: { id: true, name: true, email: true, role: true, active: true },
    })
    res.json({ ok: true, user })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
