import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'

const router = Router()

// GET /api/notifications?page=1&limit=50&channel=WHATSAPP&success=true
router.get('/', async (req: Request, res: Response) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
  const skip = (page - 1) * limit

  const where: Record<string, unknown> = {}
  if (req.query.channel) where.channel = req.query.channel
  if (req.query.success !== undefined) where.success = req.query.success === 'true'
  if (req.query.orderNumber) {
    where.order = { orderNumber: { contains: req.query.orderNumber as string, mode: 'insensitive' } }
  }

  const [items, total] = await Promise.all([
    prisma.orderNotification.findMany({
      where,
      skip,
      take: limit,
      orderBy: { sentAt: 'desc' },
      include: {
        order: { select: { orderNumber: true, customerName: true, nfNumber: true, senderCnpj: true } },
      },
    }),
    prisma.orderNotification.count({ where }),
  ])

  res.json({
    data: items,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  })
})

export default router
