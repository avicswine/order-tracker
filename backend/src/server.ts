import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import path from 'path'
import carriersRouter from './routes/carriers'
import ordersRouter from './routes/orders'
import blingRouter from './routes/bling'
import trackingRouter, { runTrackingSync } from './routes/tracking'

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

app.use('/api/carriers', carriersRouter)
app.use('/api/orders', ordersRouter)
app.use('/api/bling', blingRouter)
app.use('/api/tracking', trackingRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
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
