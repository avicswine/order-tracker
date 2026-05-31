import { Router, Request, Response } from 'express'
import { getStatus, restartInstance, logoutInstance, sendMessage, type WppCompany } from '../services/whatsapp'
import { prisma } from '../lib/prisma'
import { notifyOrderUpdate } from '../services/notifier'

const router = Router()

const VALID_COMPANIES: WppCompany[] = ['avic', 'agro']

function parseCompany(param: string): WppCompany | null {
  if (VALID_COMPANIES.includes(param as WppCompany)) return param as WppCompany
  return null
}

// GET /api/whatsapp/status — status das duas instâncias
router.get('/status', (_req: Request, res: Response) => {
  const result: Record<string, ReturnType<typeof getStatus>> = {}
  for (const company of VALID_COMPANIES) {
    result[company] = getStatus(company)
  }
  res.json(result)
})

// GET /api/whatsapp/status/:company
router.get('/status/:company', (req: Request, res: Response) => {
  const company = parseCompany(req.params.company)
  if (!company) return res.status(400).json({ error: 'Empresa inválida. Use avic ou agro.' })
  res.json(getStatus(company))
})

// POST /api/whatsapp/reiniciar/:company
router.post('/reiniciar/:company', async (req: Request, res: Response) => {
  const company = parseCompany(req.params.company)
  if (!company) return res.status(400).json({ error: 'Empresa inválida.' })
  await restartInstance(company)
  res.json({ ok: true, message: `Instância ${company} reiniciada` })
})

// POST /api/whatsapp/deslogar/:company
router.post('/deslogar/:company', async (req: Request, res: Response) => {
  const company = parseCompany(req.params.company)
  if (!company) return res.status(400).json({ error: 'Empresa inválida.' })
  await logoutInstance(company)
  res.json({ ok: true, message: `Instância ${company} deslogada` })
})

// POST /api/whatsapp/testar — envia mensagem de teste simples
router.post('/testar', async (req: Request, res: Response) => {
  const { company, phone } = req.body as { company: string; phone: string }
  const c = parseCompany(company)
  if (!c) return res.status(400).json({ error: 'Empresa inválida.' })
  if (!phone) return res.status(400).json({ error: 'Informe o número (phone).' })
  const result = await sendMessage(c, phone, `✅ Teste OrderTracker\n\nSe recebeu essa mensagem, o WhatsApp ${c.toUpperCase()} está funcionando.\n\nhttps://order-tracker-production-4189.up.railway.app/portal/`)
  res.json(result)
})

// POST /api/whatsapp/testar-notificacao — simula notificação real de um pedido
// Body: { orderNumber: "AVIC-NF-010595", phoneOverride: "554991885757" }
router.post('/testar-notificacao', async (req: Request, res: Response) => {
  const { orderNumber, phoneOverride } = req.body as { orderNumber: string; phoneOverride?: string }
  if (!orderNumber) return res.status(400).json({ error: 'Informe o orderNumber.' })

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: { carrier: { select: { name: true } } },
  })
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' })
  if (!order.lastTracking) return res.status(400).json({ error: 'Pedido sem lastTracking para notificar.' })

  // Apaga notificação anterior desse evento para forçar reenvio no teste
  const crypto = await import('crypto')
  const hash = crypto.createHash('sha256').update(`${order.id}:${order.lastTracking}`).digest('hex').slice(0, 16)
  await prisma.orderNotification.deleteMany({ where: { orderId: order.id, eventHash: hash } })

  await notifyOrderUpdate({
    ...order,
    customerPhone: phoneOverride ?? order.customerPhone,
  })

  res.json({ ok: true, orderNumber, lastTracking: order.lastTracking, phoneUsed: phoneOverride ?? order.customerPhone })
})

// POST /api/whatsapp/simular-sequencia
// Simula 4 mensagens reais com delays de 60s: despacho → update → update(mesmo dia) → entregue
// Body: { orderNumber, phoneOverride, emailOverride }
router.post('/simular-sequencia', async (req: Request, res: Response) => {
  const { orderNumber, phoneOverride, emailOverride } = req.body as {
    orderNumber: string
    phoneOverride?: string
    emailOverride?: string
  }
  if (!orderNumber) return res.status(400).json({ error: 'Informe o orderNumber.' })

  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: { carrier: { select: { name: true } } },
  })
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' })

  type StoredEvent = { date: string | null; description: string }
  const events: StoredEvent[] = Array.isArray(order.trackingEvents)
    ? (order.trackingEvents as StoredEvent[]).slice().reverse() // mais antigo primeiro
    : []

  if (events.length < 2) return res.status(400).json({ error: 'Pedido sem eventos suficientes para simular.' })

  // Apaga todas as notificações existentes para forçar isFirstEver=true
  await prisma.orderNotification.deleteMany({ where: { orderId: order.id } })

  const base = {
    ...order,
    customerPhone: phoneOverride ?? order.customerPhone,
    customerEmail: emailOverride ?? order.customerEmail,
  }

  // Sequência: primeiro evento (despacho), 2 intermediários, último (entregue)
  const seq = [
    events[0],                                    // 1. Despacho
    events[Math.floor(events.length / 2)],        // 2. Meio (update)
    events[Math.floor(events.length * 3 / 4)],   // 3. Avançado (Oi eu novamente)
    events[events.length - 1],                    // 4. Entregue
  ]

  res.json({ ok: true, mensagens: seq.map(e => e.description), delays: ['agora', '60s', '120s', '180s'] })

  // Dispara cada mensagem com delay — fire-and-forget
  for (let i = 0; i < seq.length; i++) {
    const ev = seq[i]
    setTimeout(async () => {
      try {
        // Remove notificação anterior desse evento para permitir reenvio
        const crypto = await import('crypto')
        const hash = crypto.createHash('sha256').update(`${order.id}:${ev.description}`).digest('hex').slice(0, 16)
        await prisma.orderNotification.deleteMany({ where: { orderId: order.id, eventHash: hash } })

        await notifyOrderUpdate({ ...base, lastTracking: ev.description, lastTrackingAt: ev.date ? new Date(ev.date) : new Date() })
        console.log(`[Simulação] Mensagem ${i + 1}/4 enviada: ${ev.description.slice(0, 60)}`)
      } catch (err) {
        console.error(`[Simulação] Erro na mensagem ${i + 1}:`, err)
      }
    }, i * 60_000) // 0s, 60s, 120s, 180s
  }
})

export default router
