import { Router, Request, Response } from 'express'
import { body, param, query, validationResult } from 'express-validator'
import { prisma } from '../lib/prisma'
import { TrackingSystem, OrderStatus } from '@prisma/client'

const router = Router()

// GET /carriers/ranking
router.get(
  '/ranking',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const dateFilter: Record<string, unknown> = {}
    if (req.query.startDate || req.query.endDate) {
      dateFilter.nfIssuedAt = {
        ...(req.query.startDate && { gte: new Date(req.query.startDate as string) }),
        ...(req.query.endDate && { lte: new Date(req.query.endDate as string) }),
      }
    }

    try {
      const carriers = await prisma.carrier.findMany({
        where: { active: true },
        orderBy: { name: 'asc' },
        include: {
          orders: {
            where: dateFilter,
            select: {
              status: true,
              estimatedDelivery: true,
              shippedAt: true,
              deliveredAt: true,
              nfValue: true,
              nfNumber: true,
              customerName: true,
              senderCnpj: true,
              hasOccurrence: true,
            },
          },
        },
      })

      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

      const ranking = carriers
        .filter((c) => c.orders.length > 0)
        .map((c) => {
          const total = c.orders.length
          const delivered = c.orders.filter((o) => o.status === OrderStatus.DELIVERED).length
          const cancelled = c.orders.filter((o) => o.status === OrderStatus.CANCELLED).length
          const isDelayed = (o: typeof c.orders[0]) => {
            if (!o.estimatedDelivery) return false
            const e = new Date(o.estimatedDelivery); e.setHours(0, 0, 0, 0)
            if (o.status === OrderStatus.PENDING || o.status === OrderStatus.IN_TRANSIT) return e < todayStart
            if (o.status === OrderStatus.DELIVERED && o.deliveredAt) {
              const d = new Date(o.deliveredAt); d.setHours(0, 0, 0, 0)
              return d > e
            }
            return false
          }

          const delayedOrders = c.orders
            .filter(isDelayed)
            .map((o) => {
              const e = new Date(o.estimatedDelivery!); e.setHours(0, 0, 0, 0)
              const ref = o.status === OrderStatus.DELIVERED && o.deliveredAt
                ? new Date(o.deliveredAt)
                : todayStart
              const refDay = new Date(ref); refDay.setHours(0, 0, 0, 0)
              return {
                nfNumber: o.nfNumber,
                customerName: o.customerName,
                shippedAt: o.shippedAt,
                deliveredAt: o.deliveredAt,
                estimatedDelivery: o.estimatedDelivery,
                daysDelayed: Math.round((refDay.getTime() - e.getTime()) / 86400000),
                senderCnpj: o.senderCnpj,
              }
            })
            .sort((a, b) => b.daysDelayed - a.daysDelayed)

          const delayed = delayedOrders.length
          const totalNfValue = c.orders.reduce((sum, o) => sum + (o.nfValue ?? 0), 0)

          // Média de dias de atraso (somente pedidos atrasados)
          const avgDelayDays =
            delayedOrders.length > 0
              ? Math.round(delayedOrders.reduce((sum, o) => sum + o.daysDelayed, 0) / delayedOrders.length * 10) / 10
              : null

          const occurrences = c.orders.filter((o) => o.hasOccurrence).length

          return {
            carrierId: c.id,
            carrierName: c.name,
            trackingSystem: c.trackingSystem,
            trackingIdentifier: c.trackingIdentifier,
            total,
            delivered,
            cancelled,
            delayed,
            delayedOrders,
            inTransit: c.orders.filter((o) => o.status === OrderStatus.IN_TRANSIT).length,
            pending: c.orders.filter((o) => o.status === OrderStatus.PENDING).length,
            deliveryRate: total > 0 ? delivered / total : 0,
            delayRate: total > 0 ? delayed / total : 0,
            totalNfValue,
            avgDeliveryDays: avgDelayDays,
            occurrences,
            occurrenceRate: total > 0 ? occurrences / total : 0,
          }
        })
        .sort((a, b) => b.total - a.total)

      res.json(ranking)
    } catch {
      res.status(500).json({ error: 'Failed to fetch ranking' })
    }
  }
)

// GET /carriers
router.get('/', async (_req: Request, res: Response) => {
  try {
    const carriers = await prisma.carrier.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { orders: true } } },
    })
    res.json(carriers)
  } catch {
    res.status(500).json({ error: 'Failed to fetch carriers' })
  }
})

// GET /carriers/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const carrier = await prisma.carrier.findUnique({
      where: { id: req.params.id },
      include: { orders: { orderBy: { createdAt: 'desc' }, take: 10 } },
    })
    if (!carrier) return res.status(404).json({ error: 'Carrier not found' })
    res.json(carrier)
  } catch {
    res.status(500).json({ error: 'Failed to fetch carrier' })
  }
})

// POST /carriers
router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('cnpj')
      .trim()
      .matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/)
      .withMessage('CNPJ must be in format XX.XXX.XXX/XXXX-XX'),
    body('phone').trim().notEmpty().withMessage('Phone is required'),
    body('trackingSystem').optional().isIn(Object.values(TrackingSystem)),
    body('trackingIdentifier').optional().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const carrier = await prisma.carrier.create({
        data: {
          name: req.body.name,
          cnpj: req.body.cnpj,
          phone: req.body.phone,
          ...(req.body.trackingSystem && { trackingSystem: req.body.trackingSystem }),
          trackingIdentifier: req.body.trackingIdentifier ?? null,
        },
      })
      res.status(201).json(carrier)
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
        return res.status(409).json({ error: 'CNPJ already registered' })
      }
      res.status(500).json({ error: 'Failed to create carrier' })
    }
  }
)

// PUT /carriers/:id
router.put(
  '/:id',
  [
    param('id').notEmpty(),
    body('name').optional().trim().notEmpty(),
    body('cnpj').optional().trim().matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/),
    body('phone').optional().trim().notEmpty(),
    body('active').optional().isBoolean(),
    body('trackingSystem').optional().isIn(Object.values(TrackingSystem)),
    body('trackingIdentifier').optional().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const carrier = await prisma.carrier.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.name !== undefined && { name: req.body.name }),
          ...(req.body.cnpj !== undefined && { cnpj: req.body.cnpj }),
          ...(req.body.phone !== undefined && { phone: req.body.phone }),
          ...(req.body.active !== undefined && { active: req.body.active }),
          ...(req.body.trackingSystem !== undefined && { trackingSystem: req.body.trackingSystem }),
          ...(req.body.trackingIdentifier !== undefined && { trackingIdentifier: req.body.trackingIdentifier || null }),
        },
      })
      res.json(carrier)
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') {
        return res.status(404).json({ error: 'Carrier not found' })
      }
      res.status(500).json({ error: 'Failed to update carrier' })
    }
  }
)

// DELETE /carriers/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.carrier.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err) {
      const code = (err as { code: string }).code
      if (code === 'P2025') return res.status(404).json({ error: 'Carrier not found' })
      if (code === 'P2003' || code === 'P2014') {
        return res.status(409).json({ error: 'Transportadora possui pedidos vinculados. Remova os pedidos antes de excluir.' })
      }
    }
    res.status(500).json({ error: 'Failed to delete carrier' })
  }
})

export default router
