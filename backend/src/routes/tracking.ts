import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { trackSSW, trackSenior } from '../services/tracking'
import { OrderStatus, TrackingSystem } from '@prisma/client'

const router = Router()

// POST /api/tracking/sync — atualiza status de todos os pedidos IN_TRANSIT
router.post('/sync', async (_req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.PENDING, OrderStatus.IN_TRANSIT] },
      nfNumber: { not: null },
      senderCnpj: { not: null },
      carrier: { trackingSystem: { not: TrackingSystem.NONE } },
    },
    include: { carrier: true },
  })

  if (orders.length === 0) {
    return res.json({ message: 'Nenhum pedido para rastrear.', atualizados: 0, erros: 0 })
  }

  let atualizados = 0
  let erros = 0

  for (const order of orders) {
    const carrier = order.carrier!
    const cnpj = order.senderCnpj!
    const nf = order.nfNumber!

    try {
      let result

      if (carrier.trackingSystem === TrackingSystem.SSW) {
        result = await trackSSW(cnpj, nf, carrier.trackingIdentifier ?? undefined)
      } else if (carrier.trackingSystem === TrackingSystem.SENIOR) {
        if (!carrier.trackingIdentifier) {
          console.warn(`[Tracking] ${order.orderNumber}: Senior sem tenant configurado`)
          continue
        }
        result = await trackSenior(cnpj, nf, carrier.trackingIdentifier)
      } else {
        continue
      }

      const novoStatus = result.status
      const lastEvent = result.lastEvent

      console.log(`[Tracking] ${order.orderNumber} (${carrier.name}): "${lastEvent}" → ${novoStatus ?? 'sem mapeamento'}`)

      const updates: Record<string, unknown> = {
        lastTracking: lastEvent,
        lastTrackingAt: new Date(),
      }

      // Atualiza status somente se houve mudança e temos um status mapeado
      if (novoStatus && novoStatus !== order.status) {
        updates.status = novoStatus
        if (novoStatus === OrderStatus.DELIVERED) updates.deliveredAt = new Date()

        await prisma.order.update({
          where: { id: order.id },
          data: {
            ...updates,
            statusHistory: {
              create: {
                status: novoStatus,
                note: `Atualizado automaticamente via rastreamento: ${lastEvent}`,
              },
            },
          },
        })
      } else {
        await prisma.order.update({ where: { id: order.id }, data: updates })
      }

      atualizados++

      // Pausa entre requisições para não sobrecarregar as APIs
      await new Promise((r) => setTimeout(r, 500))
    } catch (err) {
      console.error(`[Tracking] Erro ao rastrear ${order.orderNumber}:`, err)
      erros++
    }
  }

  res.json({ message: 'Rastreamento concluído', atualizados, erros, total: orders.length })
})

// GET /api/tracking/status — retorna último tracking de cada pedido IN_TRANSIT
router.get('/status', async (_req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { status: { in: [OrderStatus.PENDING, OrderStatus.IN_TRANSIT] } },
    select: {
      id: true,
      orderNumber: true,
      nfNumber: true,
      status: true,
      lastTracking: true,
      lastTrackingAt: true,
      carrier: { select: { name: true, trackingSystem: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json(orders)
})

export default router
