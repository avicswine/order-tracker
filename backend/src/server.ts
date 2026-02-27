import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import path from 'path'
import carriersRouter from './routes/carriers'
import ordersRouter from './routes/orders'
import blingRouter from './routes/bling'
import trackingRouter, { runTrackingSync } from './routes/tracking'
import authRouter from './routes/auth'
import { requireAuth } from './middleware/auth'
import { prisma } from './lib/prisma'
import bcrypt from 'bcryptjs'

const app = express()
const PORT = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

// Em produção serve o frontend buildado — sem CORS necessário
if (isProd) {
  const frontendDist = path.join(__dirname, '../../frontend/dist')
  app.use(express.static(frontendDist))
} else {
  app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }))
}

app.use(express.json())

app.use('/api/auth', authRouter)
app.use('/api/carriers', requireAuth, carriersRouter)
app.use('/api/orders', requireAuth, ordersRouter)
app.use('/api/bling', requireAuth, blingRouter)
app.use('/api/tracking', requireAuth, trackingRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Endpoint temporário de setup — só funciona se não houver nenhum usuário cadastrado
app.post('/api/setup', async (req, res) => {
  const count = await prisma.user.count()
  if (count > 0) {
    return res.status(403).json({ error: 'Setup já realizado' })
  }
  const { name, email, password } = req.body
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email e password são obrigatórios' })
  }
  const hashed = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: { name, email, password: hashed, role: 'ADMIN' },
    select: { id: true, name: true, email: true, role: true },
  })
  res.json({ ok: true, user })
})

// Em produção, qualquer rota não-API devolve o index.html (SPA)
if (isProd) {
  const frontendDist = path.join(__dirname, '../../frontend/dist')
  app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')))
}

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`)

  // Sincronização automática a cada 2 horas
  cron.schedule('0 */2 * * *', async () => {
    console.log('[Cron] Iniciando sync automático de rastreamento...')
    const result = await runTrackingSync()
    console.log(`[Cron] Sync concluído — atualizados: ${result.atualizados}, erros: ${result.erros}, total: ${result.total}`)
  })
  console.log('[Cron] Sync de rastreamento agendado a cada 2 horas')
})

export default app
