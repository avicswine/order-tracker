import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { notifyBatchEnviado, notifyFaturado, notifyOrderUpdate } from '../services/notifier'

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

// GET  /api/notifications/falhas?dias=30&empresa=47715256000149
// POST /api/notifications/falhas/reenviar { dias?, empresa? }
//
// Quando o WhatsApp cai, a notificação fica registrada com success:false e ninguém
// a recupera: o sync só chama o notificador quando o rastreio MUDA. Estas rotas
// listam e reenviam essas pendências.
//
// Reenvia UMA vez por pedido, com a mensagem do ESTADO ATUAL (não o evento velho):
// quem estava "em trânsito" e já foi entregue recebe "entregue", não um aviso vencido.
// A deduplicação normal (success:true) evita mandar duas vezes.
async function pedidosComFalha(dias: number, empresa?: string) {
  const desde = new Date(Date.now() - dias * 86400000)
  const falhas = await prisma.orderNotification.findMany({
    where: {
      success: false,
      sentAt: { gte: desde },
      order: { ...(empresa && { senderCnpj: empresa }) },
    },
    select: { orderId: true, eventHash: true, eventText: true, channel: true, error: true, sentAt: true },
    orderBy: { sentAt: 'desc' },
  })
  if (falhas.length === 0) return []

  // Descarta as que depois foram entregues com sucesso (mesmo pedido + mesmo evento)
  const sucessos = await prisma.orderNotification.findMany({
    where: { success: true, orderId: { in: [...new Set(falhas.map((f) => f.orderId))] } },
    select: { orderId: true, eventHash: true },
  })
  const jaEnviadas = new Set(sucessos.map((s) => `${s.orderId}:${s.eventHash}`))

  const pendentesPorPedido = new Map<string, typeof falhas[number]>()
  for (const f of falhas) {
    if (jaEnviadas.has(`${f.orderId}:${f.eventHash}`)) continue
    if (!pendentesPorPedido.has(f.orderId)) pendentesPorPedido.set(f.orderId, f) // a mais recente
  }
  if (pendentesPorPedido.size === 0) return []

  const orders = await prisma.order.findMany({
    where: { id: { in: [...pendentesPorPedido.keys()] } },
    select: {
      id: true, orderNumber: true, nfNumber: true, customerName: true,
      customerEmail: true, customerPhone: true, senderCnpj: true,
      status: true, estimatedDelivery: true, lastTracking: true, lastTrackingAt: true,
      linkDanfe: true, nfIssuedAt: true,
    },
  })
  return orders.map((o) => ({ order: o, falha: pendentesPorPedido.get(o.id)! }))
}

router.get('/falhas', async (req: Request, res: Response) => {
  const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 180)
  const lista = await pedidosComFalha(dias, req.query.empresa as string | undefined)
  res.json({
    total: lista.length,
    pedidos: lista.map(({ order, falha }) => ({
      orderNumber: order.orderNumber,
      cliente: order.customerName,
      telefone: order.customerPhone,
      status: order.status,
      eventoQueFalhou: falha.eventText,
      erro: falha.error,
      falhouEm: falha.sentAt,
      eventoAtual: order.lastTracking,
    })),
  })
})

router.post('/falhas/reenviar', async (req: Request, res: Response) => {
  const body = req.body as { dias?: number; empresa?: string }
  const dias = Math.min(Math.max(Number(body.dias) || 30, 1), 180)
  const lista = await pedidosComFalha(dias, body.empresa)

  res.json({ message: `Reenviando para ${lista.length} pedido(s)...`, total: lista.length })

  // Fire-and-forget — o envio leva tempo (1 msg por pedido, com intervalo)
  setImmediate(async () => {
    let enviados = 0, erros = 0
    for (const { order, falha } of lista) {
      try {
        if (falha.eventText === 'FATURADO') {
          await notifyFaturado(order)
        } else {
          await notifyOrderUpdate(order)
        }
        enviados++
        await new Promise((r) => setTimeout(r, 800))
      } catch (err) {
        erros++
        console.error(`[Reenvio] ${order.orderNumber}:`, err instanceof Error ? err.message : err)
      }
    }
    console.log(`[Reenvio] Concluído: ${enviados} processado(s), ${erros} erro(s) de ${lista.length} pedido(s)`)
  })
})

// POST /api/notifications/batch-enviado
// Envia notificação ENVIADO para todos os pedidos IN_TRANSIT sem notificação prévia.
// A deduplicação garante que cada pedido recebe apenas uma vez.
router.post('/batch-enviado', async (req: Request, res: Response) => {
  const cutoffStr = (req.body as { cutoff?: string }).cutoff ?? '2026-06-01'
  const cutoff = new Date(cutoffStr)
  // Busca IN_TRANSIT sem nenhuma notificação bem-sucedida (NFs desde o corte)
  const orders = await prisma.order.findMany({
    where: {
      status: 'IN_TRANSIT',
      lastTracking: { not: null },
      nfIssuedAt: { gte: cutoff },
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
