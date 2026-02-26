import { Router, Request, Response } from 'express'
import { body, query, param, validationResult } from 'express-validator'
import { prisma } from '../lib/prisma'
import { OrderStatus } from '@prisma/client'

const router = Router()

// GET /orders  (with filters)
router.get(
  '/',
  [
    query('status').optional().isIn(Object.values(OrderStatus)),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('search').optional().trim(),
    query('nfNumber').optional().trim(),
    query('senderCnpj').optional().trim(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('delayed').optional().isBoolean().toBoolean(),
    query('sortBy').optional().isIn(['shippedAt', 'estimatedDelivery']),
    query('sortOrder').optional().isIn(['asc', 'desc']),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const page = (req.query.page as unknown as number) || 1
    const limit = (req.query.limit as unknown as number) || 20
    const skip = (page - 1) * limit

    const where: Record<string, unknown> = {}

    if (req.query.status) where.status = req.query.status as OrderStatus

    if (req.query.startDate || req.query.endDate) {
      where.createdAt = {
        ...(req.query.startDate && { gte: new Date(req.query.startDate as string) }),
        ...(req.query.endDate && { lte: new Date(req.query.endDate as string) }),
      }
    }

    if (req.query.search) {
      const search = req.query.search as string
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { nfNumber: { contains: search, mode: 'insensitive' } },
      ]
    }

    if (req.query.nfNumber) {
      where.nfNumber = { contains: req.query.nfNumber as string, mode: 'insensitive' }
    }

    if (req.query.senderCnpj) {
      where.senderCnpj = req.query.senderCnpj as string
    }

    if (String(req.query.delayed) === 'true') {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      where.estimatedDelivery = { lt: todayStart }
      if (!where.status) {
        where.status = { in: [OrderStatus.PENDING, OrderStatus.IN_TRANSIT] }
      }
    }

    try {
      const sortBy = req.query.sortBy as 'shippedAt' | 'estimatedDelivery' | undefined
      const sortOrder = (req.query.sortOrder as 'asc' | 'desc') || 'asc'
      const orderBy = sortBy ? { [sortBy]: sortOrder } : { createdAt: 'desc' as const }

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: { carrier: { select: { id: true, name: true, active: true } } },
        }),
        prisma.order.count({ where }),
      ])

      res.json({
        data: orders,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      })
    } catch {
      res.status(500).json({ error: 'Failed to fetch orders' })
    }
  }
)

// GET /orders/summary
router.get('/summary', async (_req: Request, res: Response) => {
  try {
    const counts = await prisma.order.groupBy({
      by: ['status'],
      _count: { status: true },
    })

    const summary = Object.values(OrderStatus).reduce(
      (acc, status) => {
        const found = counts.find((c) => c.status === status)
        acc[status] = found ? found._count.status : 0
        return acc
      },
      {} as Record<OrderStatus, number>
    )

    const total = await prisma.order.count()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const delayed = await prisma.order.count({
      where: {
        estimatedDelivery: { lt: today },
        status: { in: [OrderStatus.PENDING, OrderStatus.IN_TRANSIT] },
      },
    })
    res.json({ ...summary, TOTAL: total, DELAYED: delayed })
  } catch {
    res.status(500).json({ error: 'Failed to fetch summary' })
  }
})

// GET /orders/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: {
        carrier: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!order) return res.status(404).json({ error: 'Order not found' })
    res.json(order)
  } catch {
    res.status(500).json({ error: 'Failed to fetch order' })
  }
})

// POST /orders
router.post(
  '/',
  [
    body('orderNumber').trim().notEmpty().withMessage('Order number is required'),
    body('customerName').trim().notEmpty().withMessage('Customer name is required'),
    body('customerEmail').optional().isEmail(),
    body('carrierId').optional().notEmpty(),
    body('shippedAt').optional().isISO8601(),
    body('estimatedDelivery').optional().isISO8601(),
    body('notes').optional().trim(),
    body('nfNumber').optional().trim(),
    body('senderCnpj').optional().trim(),
    body('recipientCnpj').optional().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const order = await prisma.order.create({
        data: {
          orderNumber: req.body.orderNumber,
          customerName: req.body.customerName,
          customerEmail: req.body.customerEmail,
          carrierId: req.body.carrierId,
          shippedAt: req.body.shippedAt ? new Date(req.body.shippedAt) : null,
          estimatedDelivery: req.body.estimatedDelivery
            ? new Date(req.body.estimatedDelivery)
            : null,
          notes: req.body.notes,
          nfNumber: req.body.nfNumber,
          senderCnpj: req.body.senderCnpj,
          recipientCnpj: req.body.recipientCnpj,
          statusHistory: { create: { status: OrderStatus.PENDING, note: 'Order created' } },
        },
        include: { carrier: true, statusHistory: true },
      })
      res.status(201).json(order)
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
        return res.status(409).json({ error: 'Order number already exists' })
      }
      res.status(500).json({ error: 'Failed to create order' })
    }
  }
)

// PATCH /orders/:id/status
router.patch(
  '/:id/status',
  [
    param('id').notEmpty(),
    body('status').isIn(Object.values(OrderStatus)).withMessage('Invalid status'),
    body('note').optional().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const newStatus = req.body.status as OrderStatus
    const deliveredAt = newStatus === OrderStatus.DELIVERED ? new Date() : undefined

    try {
      const order = await prisma.order.update({
        where: { id: req.params.id },
        data: {
          status: newStatus,
          ...(deliveredAt && { deliveredAt }),
          statusHistory: {
            create: { status: newStatus, note: req.body.note },
          },
        },
        include: { carrier: true, statusHistory: { orderBy: { createdAt: 'desc' } } },
      })
      res.json(order)
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') {
        return res.status(404).json({ error: 'Order not found' })
      }
      res.status(500).json({ error: 'Failed to update order status' })
    }
  }
)

// PUT /orders/:id
router.put(
  '/:id',
  [
    param('id').notEmpty(),
    body('customerName').optional().trim().notEmpty(),
    body('customerEmail').optional().isEmail(),
    body('carrierId').optional().notEmpty(),
    body('shippedAt').optional().isISO8601(),
    body('estimatedDelivery').optional().isISO8601(),
    body('notes').optional().trim(),
    body('nfNumber').optional().trim(),
    body('senderCnpj').optional().trim(),
    body('recipientCnpj').optional().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const order = await prisma.order.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.customerName && { customerName: req.body.customerName }),
          ...(req.body.customerEmail !== undefined && { customerEmail: req.body.customerEmail }),
          ...(req.body.carrierId && { carrierId: req.body.carrierId }),
          ...(req.body.shippedAt !== undefined && {
            shippedAt: req.body.shippedAt ? new Date(req.body.shippedAt) : null,
          }),
          ...(req.body.estimatedDelivery !== undefined && {
            estimatedDelivery: req.body.estimatedDelivery
              ? new Date(req.body.estimatedDelivery)
              : null,
          }),
          ...(req.body.notes !== undefined && { notes: req.body.notes }),
          ...(req.body.nfNumber !== undefined && { nfNumber: req.body.nfNumber }),
          ...(req.body.senderCnpj !== undefined && { senderCnpj: req.body.senderCnpj }),
          ...(req.body.recipientCnpj !== undefined && { recipientCnpj: req.body.recipientCnpj }),
        },
        include: { carrier: true },
      })
      res.json(order)
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') {
        return res.status(404).json({ error: 'Order not found' })
      }
      res.status(500).json({ error: 'Failed to update order' })
    }
  }
)

// DELETE /orders/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.order.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') {
      return res.status(404).json({ error: 'Order not found' })
    }
    res.status(500).json({ error: 'Failed to delete order' })
  }
})

export default router
