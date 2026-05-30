import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cron from 'node-cron'
import path from 'path'
import carriersRouter from './routes/carriers'
import ordersRouter from './routes/orders'
import trackingRouter, { runTrackingSync } from './routes/tracking'
import blingRouter, { blingPublicRouter, loadTokensFromDB, runBlingSync } from './routes/bling'
import authRouter from './routes/auth'
import publicRouter from './routes/public'
import setupRouter from './routes/setup'
import whatsappRouter from './routes/whatsapp'
import notificationsRouter from './routes/notifications'
import { requireAuth } from './middleware/auth'
import { initWhatsApp, destroyAll } from './services/whatsapp'

const app = express()
const PORT = process.env.PORT || 3001
const isProd = process.env.NODE_ENV === 'production'

// Railway usa proxy reverso — necessário para express-rate-limit funcionar corretamente
app.set('trust proxy', 1)

// Headers de segurança HTTP
app.use(helmet({
  contentSecurityPolicy: false, // desativado para não quebrar o frontend React
  crossOriginEmbedderPolicy: false,
}))

// Rate limit geral — 300 req/min por IP (proteção contra flood)
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' },
}))

// Em produção serve o frontend buildado — sem CORS necessário
if (isProd) {
  const frontendDist = path.join(__dirname, '../../frontend/dist')
  app.use(express.static(frontendDist))
} else {
  app.use(cors({ origin: [process.env.FRONTEND_URL || 'http://localhost:5173', 'http://localhost:5174'] }))
}

app.use(express.json())

app.use('/api/auth', authRouter)
app.use('/api/setup', setupRouter)
app.use('/api/public', publicRouter)
app.use('/api/bling', blingPublicRouter)
app.use('/api/carriers', requireAuth, carriersRouter)
app.use('/api/orders', requireAuth, ordersRouter)
app.use('/api/bling', requireAuth, blingRouter)
app.use('/api/tracking', requireAuth, trackingRouter)
app.use('/api/whatsapp', requireAuth, whatsappRouter)
app.use('/api/notifications', requireAuth, notificationsRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Em produção: serve o portal do cliente em /portal e o painel em tudo mais
if (isProd) {
  const portalDist = path.join(__dirname, '../../customer-portal/dist')
  const frontendDist = path.join(__dirname, '../../frontend/dist')
  app.use('/portal', express.static(portalDist))
  app.get('/portal/*', (_req, res) => res.sendFile(path.join(portalDist, 'index.html')))
  app.get('*', (_req, res) => res.sendFile(path.join(frontendDist, 'index.html')))
}

app.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`)

  // Carrega tokens do banco na inicialização (sem disparar sync)
  loadTokensFromDB()
    .catch(err => console.error('[Startup] Erro ao carregar tokens:', err))

  // Inicia instâncias WhatsApp (AVIC + AGRO)
  initWhatsApp()

  // Sincronização automática a cada 2 horas: importa NFs novas do Bling + atualiza rastreamento
  cron.schedule('0 */2 * * *', async () => {
    console.log('[Cron] Iniciando sync Bling...')
    const bling = await runBlingSync()
    console.log(`[Cron] Bling concluído — criados: ${bling.totalCriados}, ignorados: ${bling.totalIgnorados}`)

    console.log('[Cron] Iniciando sync de rastreamento...')
    const tracking = await runTrackingSync()
    console.log(`[Cron] Rastreamento concluído — atualizados: ${tracking.atualizados}, erros: ${tracking.erros}, total: ${tracking.total}`)
  })
  console.log('[Cron] Sync automático agendado a cada 2 horas (Bling + rastreamento)')
})

export default app
