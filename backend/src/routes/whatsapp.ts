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

export default router
