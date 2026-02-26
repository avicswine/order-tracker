import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { trackSSW, trackSenior, trackWithPuppeteer, trackSaoMiguel, trackAtualCargas, trackRodonaves, trackBraspress } from '../services/tracking'
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
      } else if (carrier.trackingSystem === TrackingSystem.PUPPETEER) {
        if (!carrier.trackingIdentifier) {
          console.warn(`[Tracking] ${order.orderNumber}: PUPPETEER sem portal configurado`)
          continue
        }
        result = await trackWithPuppeteer(cnpj, nf, carrier.trackingIdentifier)
      } else if (carrier.trackingSystem === TrackingSystem.SAO_MIGUEL) {
        result = await trackSaoMiguel(cnpj, nf, order.recipientCnpj, carrier.trackingIdentifier)
      } else if (carrier.trackingSystem === TrackingSystem.ATUAL_CARGAS) {
        result = await trackAtualCargas(cnpj, nf)
      } else if (carrier.trackingSystem === TrackingSystem.RODONAVES) {
        result = await trackRodonaves(cnpj, nf)
      } else if (carrier.trackingSystem === TrackingSystem.BRASPRESS) {
        result = await trackBraspress(cnpj, nf, carrier.trackingIdentifier)
      } else {
        continue
      }

      const novoStatus = result.status
      const lastEvent = result.lastEvent

      console.log(`[Tracking] ${order.orderNumber} (${carrier.name}): "${lastEvent}" → ${novoStatus ?? 'sem mapeamento'}${result.hasOccurrence ? ' ⚠️ INTERCORRÊNCIA' : ''}${result.shippedAt ? ` | Envio: ${result.shippedAt.toLocaleDateString('pt-BR')}` : ''}${result.estimatedDelivery ? ` | Prev: ${result.estimatedDelivery.toLocaleDateString('pt-BR')}` : ''}`)

      const updates: Record<string, unknown> = {
        lastTracking: lastEvent,
        lastTrackingAt: new Date(),
      }

      // Data de envio: atualiza apenas se ainda não definida (não sobrescreve dado manual)
      if (result.shippedAt && !order.shippedAt) {
        updates.shippedAt = result.shippedAt
      }

      // Previsão de entrega: apenas dado real retornado pelo carrier
      if (result.estimatedDelivery) {
        updates.estimatedDelivery = result.estimatedDelivery
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

// POST /api/tracking/backfill — busca datas de envio/previsão para pedidos sem essas informações
// Não altera status — apenas preenche shippedAt e estimatedDelivery
router.post('/backfill', async (_req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: {
      OR: [{ shippedAt: null }, { estimatedDelivery: null }],
      nfNumber: { not: null },
      senderCnpj: { not: null },
      carrier: { trackingSystem: { notIn: [TrackingSystem.NONE, TrackingSystem.BRASPRESS, TrackingSystem.PUPPETEER] } },
    },
    include: { carrier: true },
  })

  if (orders.length === 0) {
    return res.json({ message: 'Todos os pedidos já têm dados de envio e previsão.', atualizados: 0 })
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
        if (!carrier.trackingIdentifier) continue
        result = await trackSenior(cnpj, nf, carrier.trackingIdentifier)
      } else if (carrier.trackingSystem === TrackingSystem.SAO_MIGUEL) {
        result = await trackSaoMiguel(cnpj, nf, order.recipientCnpj, carrier.trackingIdentifier)
      } else if (carrier.trackingSystem === TrackingSystem.ATUAL_CARGAS) {
        result = await trackAtualCargas(cnpj, nf)
      } else if (carrier.trackingSystem === TrackingSystem.RODONAVES) {
        result = await trackRodonaves(cnpj, nf)
      } else {
        continue
      }

      const updates: Record<string, unknown> = {}

      if (result.shippedAt && !order.shippedAt) updates.shippedAt = result.shippedAt
      if (result.estimatedDelivery && !order.estimatedDelivery) updates.estimatedDelivery = result.estimatedDelivery
      if (result.lastEvent && !order.lastTracking) updates.lastTracking = result.lastEvent

      if (Object.keys(updates).length > 0) {
        await prisma.order.update({ where: { id: order.id }, data: updates })
        console.log(`[Backfill] ${order.orderNumber}: envio=${result.shippedAt?.toLocaleDateString('pt-BR') ?? '-'} prev=${result.estimatedDelivery?.toLocaleDateString('pt-BR') ?? '-'}`)
        atualizados++
      }

      await new Promise((r) => setTimeout(r, 300))
    } catch (err) {
      console.error(`[Backfill] Erro ${order.orderNumber}:`, (err as Error).message)
      erros++
    }
  }

  res.json({ message: 'Backfill concluído', atualizados, erros, total: orders.length })
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
