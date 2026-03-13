import express from 'express'
import cors from 'cors'
import cron from 'node-cron'
import path from 'path'
import carriersRouter from './routes/carriers'
import ordersRouter from './routes/orders'
import trackingRouter, { runTrackingSync } from './routes/tracking'
import blingRouter, { runBlingSync, blingPublicRouter } from './routes/bling'
import authRouter from './routes/auth'
import { requireAuth } from './middleware/auth'

const app = express()
const PORT = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

// Em produção serve o frontend buildado — sem CORS necessário
if (isProd) {
  const frontendDist = path.join(__dirname, '../../frontend/dist')
  app.use(express.static(frontendDist))
} else {
  app.use(cors({ origin: [process.env.FRONTEND_URL || 'http://localhost:5173', 'http://localhost:5174'] }))
}

app.use(express.json())

app.use('/api/auth', authRouter)
app.use('/api/bling', blingPublicRouter)
app.use('/api/carriers', requireAuth, carriersRouter)
app.use('/api/orders', requireAuth, ordersRouter)
app.use('/api/bling', requireAuth, blingRouter)
app.use('/api/tracking', requireAuth, trackingRouter)

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

  // Sync do Bling ao iniciar — depois de concluir, dispara o rastreamento
  console.log('[Bling] Iniciando sync automático na startup...')
  runBlingSync()
    .then(r => {
      console.log(`[Bling] Sync concluído — criados: ${r.totalCriados}, ignorados: ${r.totalIgnorados}`)
      console.log('[Tracking] Iniciando sync de rastreamento na startup...')
      return runTrackingSync()
    })
    .then(r => {
      console.log(`[Tracking] Sync concluído — atualizados: ${r.atualizados}, erros: ${r.erros}, total: ${r.total}`)
    })
    .catch(err => console.error('[Startup] Erro no sync:', err))

  // Sincronização automática a cada 2 horas
  cron.schedule('0 */2 * * *', async () => {
    console.log('[Cron] Iniciando sync automático de rastreamento...')
    const result = await runTrackingSync()
    console.log(`[Cron] Sync concluído — atualizados: ${result.atualizados}, erros: ${result.erros}, total: ${result.total}`)
  })
  console.log('[Cron] Sync de rastreamento agendado a cada 2 horas')
})

export default app
