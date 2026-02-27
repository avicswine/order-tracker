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
            },
          },
        },
      })

      const now = new Date()

      const ranking = carriers
        .filter((c) => c.orders.length > 0)
        .map((c) => {
          const total = c.orders.length
          const delivered = c.orders.filter((o) => o.status === OrderStatus.DELIVERED).length
          const cancelled = c.orders.filter((o) => o.status === OrderStatus.CANCELLED).length
          const delayed = c.orders.filter(
            (o) =>
              o.estimatedDelivery &&
              (
                // Ainda em aberto e já passou a previsão
                (new Date(o.estimatedDelivery) < now &&
                  (o.status === OrderStatus.PENDING || o.status === OrderStatus.IN_TRANSIT)) ||
                // Entregue, mas depois da data prevista (compara só a data, ignora hora)
                (o.status === OrderStatus.DELIVERED &&
                  o.deliveredAt !== null &&
                  (() => {
                    const d = new Date(o.deliveredAt!); d.setHours(0, 0, 0, 0)
                    const e = new Date(o.estimatedDelivery!); e.setHours(0, 0, 0, 0)
                    return d > e
                  })())
              )
          ).length
          const totalNfValue = c.orders.reduce((sum, o) => sum + (o.nfValue ?? 0), 0)

          // Tempo médio de entrega (dias entre shippedAt e deliveredAt)
          const deliveredWithDates = c.orders.filter(
            (o) => o.status === OrderStatus.DELIVERED && o.shippedAt && o.deliveredAt
          )
          const avgDeliveryDays =
            deliveredWithDates.length > 0
              ? deliveredWithDates.reduce((sum, o) => {
                  const days = (new Date(o.deliveredAt!).getTime() - new Date(o.shippedAt!).getTime()) / 86400000
                  return sum + days
                }, 0) / deliveredWithDates.length
              : null

          return {
            carrierId: c.id,
            carrierName: c.name,
            trackingSystem: c.trackingSystem,
            total,
            delivered,
            cancelled,
            delayed,
            inTransit: c.orders.filter((o) => o.status === OrderStatus.IN_TRANSIT).length,
            pending: c.orders.filter((o) => o.status === OrderStatus.PENDING).length,
            deliveryRate: total > 0 ? delivered / total : 0,
            delayRate: total > 0 ? delayed / total : 0,
            totalNfValue,
            avgDeliveryDays: avgDeliveryDays !== null ? Math.round(avgDeliveryDays * 10) / 10 : null,
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
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') {
      return res.status(404).json({ error: 'Carrier not found' })
    }
    res.status(500).json({ error: 'Failed to delete carrier' })
  }
})

export default router
