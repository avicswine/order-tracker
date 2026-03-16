import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { prisma } from '../lib/prisma'

const router = Router()

// Rate limit no portal público — 30 req/min por IP
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde um momento.' },
})

// GET /api/public/tracking?document=CNPJ_OU_CPF
router.get('/tracking', publicLimiter, async (req: Request, res: Response) => {
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
