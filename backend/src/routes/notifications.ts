import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { notifyBatchEnviado, notifyFaturado } from '../services/notifier'

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

// DELETE /api/notifications?recipient=XXX — remove logs por destinatário (limpeza de testes)
router.delete('/', async (req: Request, res: Response) => {
  const recipient = req.query.recipient as string | undefined
  if (!recipient) return res.status(400).json({ error: 'Informe o recipient.' })
  const result = await prisma.orderNotification.deleteMany({ where: { recipient } })
  res.json({ ok: true, removidos: result.count, recipient })
})

// POST /api/notifications/batch-enviado
// Envia notificação ENVIADO para todos os pedidos IN_TRANSIT sem notificação prévia.
// A deduplicação garante que cada pedido recebe apenas uma vez.
router.post('/batch-enviado', async (_req: Request, res: Response) => {
  // Busca IN_TRANSIT sem nenhuma notificação bem-sucedida
  const orders = await prisma.order.findMany({
    where: {
      status: 'IN_TRANSIT',
      lastTracking: { not: null },
      notifications: { none: { success: true } },
    },
    select: {
      id: true, orderNumber: true, nfNumber: true,
      customerName: true, customerEmail: true, customerPhone: true,
      senderCnpj: true, shippedAt: true, estimatedDelivery: true,
    },
  })

  res.json({ message: `Disparando ENVIADO para ${orders.length} pedidos...`, total: orders.length })

  // Fire-and-forget — processa em background sem bloquear a resposta
  setImmediate(async () => {
    let enviados = 0, pulados = 0
    for (const order of orders) {
      try {
        await notifyBatchEnviado(order)
        enviados++
        await new Promise(r => setTimeout(r, 500))
      } catch (err) {
        pulados++
        console.error(`[BatchEnviado] Erro em ${order.orderNumber}:`, err instanceof Error ? err.message : err)
      }
    }
    console.log(`[BatchEnviado] Concluído: ${enviados} enviados, ${pulados} erros de ${orders.length} pedidos`)
  })
})

// POST /api/notifications/batch-faturado
// Envia notificação FATURADO para pedidos com NF (status PENDING/Faturado)
// que ainda não receberam o FATURADO com sucesso.
// Apenas NFs emitidas a partir de 01/06/2026 (configurável via body.cutoff).
router.post('/batch-faturado', async (req: Request, res: Response) => {
  const cutoffStr = (req.body as { cutoff?: string }).cutoff ?? '2026-06-01'
  const cutoff = new Date(cutoffStr)

  const orders = await prisma.order.findMany({
    where: {
      status: 'PENDING',
      nfNumber: { not: null },
      nfIssuedAt: { gte: cutoff },
    },
    select: {
      id: true, orderNumber: true, nfNumber: true,
      customerName: true, customerEmail: true, customerPhone: true,
      senderCnpj: true, linkDanfe: true, nfIssuedAt: true,
    },
  })

  res.json({ message: `Disparando FATURADO (NFs desde ${cutoffStr}) para até ${orders.length} pedidos...`, total: orders.length })

  setImmediate(async () => {
    let enviados = 0, pulados = 0
    for (const order of orders) {
      try {
        await notifyFaturado(order)  // dedup interno (success:true) já pula quem recebeu
        enviados++
        await new Promise(r => setTimeout(r, 500))
      } catch (err) {
        pulados++
        console.error(`[BatchFaturado] Erro em ${order.orderNumber}:`, err instanceof Error ? err.message : err)
      }
    }
    console.log(`[BatchFaturado] Concluído: ${enviados} processados, ${pulados} erros de ${orders.length} pedidos`)
  })
})

export default router
