import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'

const router = Router()

// Rate limit simples: 30 req/min por IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (entry.count >= 30) return false
  entry.count++
  return true
}

// GET /api/public/tracking?document=CNPJ_OU_CPF
router.get('/tracking', async (req: Request, res: Response) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ?? req.socket.remoteAddress ?? 'unknown'
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Muitas requisições. Aguarde um momento.' })
  }

  const raw = (req.query.document as string ?? '').replace(/\D/g, '')
  if (!raw || (raw.length !== 11 && raw.length !== 14)) {
    return res.status(400).json({ error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.' })
  }

  const orders = await prisma.order.findMany({
    where: {
      recipientCnpj: { contains: raw },
    },
    include: { carrier: { select: { name: true } } },
    orderBy: { nfIssuedAt: 'desc' },
    take: 50,
  })

  const result = orders.map(o => ({
    orderNumber: o.orderNumber,
    nfNumber: o.nfNumber,
    nfValue: o.nfValue,
    nfIssuedAt: o.nfIssuedAt,
    customerName: o.customerName,
    status: o.status,
    shippedAt: o.shippedAt,
    estimatedDelivery: o.estimatedDelivery,
    deliveredAt: o.deliveredAt,
    lastTracking: o.lastTracking,
    lastTrackingAt: o.lastTrackingAt,
    carrierName: o.carrier?.name ?? null,
    trackingEvents: o.trackingEvents,
  }))

  res.json(result)
})

export default router
