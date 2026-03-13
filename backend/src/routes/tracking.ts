import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { trackSSW, trackSenior, trackWithPuppeteer, trackSaoMiguel, trackAtualCargas, trackRodonaves, trackBraspress } from '../services/tracking'
import { OrderStatus, TrackingSystem, Prisma } from '@prisma/client'

const router = Router()

export async function runTrackingSync(): Promise<{ atualizados: number; erros: number; total: number }> {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.PENDING, OrderStatus.IN_TRANSIT] },
      nfNumber: { not: null },
      senderCnpj: { not: null },
      carrier: { trackingSystem: { not: TrackingSystem.NONE } },
    },
    include: { carrier: true },
  })

  if (orders.length === 0) return { atualizados: 0, erros: 0, total: 0 }

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

      let novoStatus = result.status
      let lastEvent = result.lastEvent

      // Se a API retornou IN_TRANSIT mas há um evento de entrega no histórico,
      // prevalece DELIVERED — evita regressão por eventos pós-entrega da transportadora.
      if (novoStatus === OrderStatus.IN_TRANSIT && result.events && result.events.length > 0) {
        const deliveredEvent = result.events.find((e) => {
          const t = e.description.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          return (
            t.includes('ENTREGUE') ||
            t.includes('ENTREGA REALIZADA') ||
            t.includes('ENTREGA EFETUADA') ||
            t.includes('OCORRENCIA DE ENTREGA')
          )
        })
        if (deliveredEvent) {
          novoStatus = OrderStatus.DELIVERED
          lastEvent = deliveredEvent.description
          console.log(`[Tracking] ${order.orderNumber}: evento pós-entrega detectado — revertendo para DELIVERED (evento: "${deliveredEvent.description}" em ${deliveredEvent.date?.toLocaleDateString('pt-BR') ?? '?'})`)
        }
      }

      console.log(`[Tracking] ${order.orderNumber} (${carrier.name}): "${lastEvent}" → ${novoStatus ?? 'sem mapeamento'}${result.hasOccurrence ? ' ⚠️ INTERCORRÊNCIA' : ''}${result.shippedAt ? ` | Envio: ${result.shippedAt.toLocaleDateString('pt-BR')}` : ''}${result.estimatedDelivery ? ` | Prev: ${result.estimatedDelivery.toLocaleDateString('pt-BR')}` : ''}`)

      const updates: Record<string, unknown> = {
        lastTracking: lastEvent,
        lastTrackingAt: new Date(),
        hasOccurrence: result.hasOccurrence ?? false,
      }

      if (result.events) {
        // Carrier retorna histórico completo — substitui
        updates.trackingEvents = result.events.map((e) => ({
          date: e.date?.toISOString() ?? null,
          description: e.description,
        }))
      } else if (lastEvent) {
        // Carrier retorna apenas evento atual (ex: Atual Cargas) — acumula
        type StoredEvent = { date: string | null; description: string }
        const existing = Array.isArray(order.trackingEvents)
          ? (order.trackingEvents as StoredEvent[])
          : []
        // Adiciona apenas se diferente do evento mais recente já armazenado
        const mostRecent = existing[0]?.description
        if (lastEvent !== mostRecent) {
          updates.trackingEvents = [{ date: new Date().toISOString(), description: lastEvent }, ...existing]
        }
      }

      if (result.shippedAt && !order.shippedAt) updates.shippedAt = result.shippedAt
      if (result.estimatedDelivery) updates.estimatedDelivery = result.estimatedDelivery

      if (novoStatus && novoStatus !== order.status) {
        updates.status = novoStatus
        if (novoStatus === OrderStatus.DELIVERED) {
          // Busca o evento de entrega no histórico (pode não ser o events[0] se houve evento pós-entrega)
          const deliveredEvent = result.events?.find((e) => {
            const t = e.description.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            return t.includes('ENTREGUE') || t.includes('ENTREGA REALIZADA') || t.includes('ENTREGA EFETUADA') || t.includes('OCORRENCIA DE ENTREGA')
          })
          const eventDate = deliveredEvent?.date ?? result.events?.[0]?.date
          updates.deliveredAt = (eventDate instanceof Date && !isNaN(eventDate.getTime()))
            ? eventDate
            : new Date()
        }

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
      await new Promise((r) => setTimeout(r, 500))
    } catch (err) {
      console.error(`[Tracking] Erro ao rastrear ${order.orderNumber}:`, err)
      erros++
    }
  }

  return { atualizados, erros, total: orders.length }
}

// POST /api/tracking/sync — disparo manual
router.post('/sync', async (_req: Request, res: Response) => {
  const result = await runTrackingSync()
  res.json({ message: 'Rastreamento concluído', ...result })
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

// POST /api/tracking/backfill-occurrence — preenche hasOccurrence com base em trackingEvents existente
router.post('/backfill-occurrence', async (_req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: { NOT: { trackingEvents: { equals: Prisma.JsonNull } } },
    select: { id: true, orderNumber: true, trackingEvents: true },
  })

  const OCCURRENCE_KEYWORDS = [
    'TENTATIVA DE ENTREGA', 'DESTINATARIO AUSENTE', 'ENDERECO NAO ENCONTRADO',
    'ENDERECO INCORRETO', 'ESTABELECIMENTO FECHADO', 'AVARIA', 'EXTRAVIO',
    'RETIDO', 'RECUSADO', 'DEVOLUCAO', 'SINISTRO', 'EXTRAVIO',
  ]

  function hasOccurrenceInEvents(events: unknown): boolean {
    if (!Array.isArray(events)) return false
    return events.some((e) => {
      const desc = ((e as { description?: string }).description ?? '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      return OCCURRENCE_KEYWORDS.some((kw) => desc.includes(kw))
    })
  }

  let atualizados = 0
  for (const order of orders) {
    const value = hasOccurrenceInEvents(order.trackingEvents)
    await prisma.order.update({ where: { id: order.id }, data: { hasOccurrence: value } })
    if (value) {
      console.log(`[BackfillOccurrence] ${order.orderNumber}: intercorrência detectada`)
      atualizados++
    }
  }

  res.json({ message: 'Backfill de intercorrências concluído', comOcorrencia: atualizados, total: orders.length })
})

// POST /api/tracking/backfill-sm-delivery — corrige deliveredAt dos pedidos SAO_MIGUEL usando dateandhourdelivery da API
router.post('/backfill-sm-delivery', async (_req: Request, res: Response) => {
  const orders = await prisma.order.findMany({
    where: {
      status: OrderStatus.DELIVERED,
      carrier: { trackingSystem: TrackingSystem.SAO_MIGUEL },
      nfNumber: { not: null },
      senderCnpj: { not: null },
    },
    include: { carrier: true },
  })

  if (orders.length === 0) return res.json({ message: 'Nenhum pedido SAO_MIGUEL entregue encontrado.', atualizados: 0 })

  let atualizados = 0
  let semDado = 0
  let erros = 0

  for (const order of orders) {
    const cnpj = order.senderCnpj!
    const nf = order.nfNumber!
    const recipientCnpj = order.recipientCnpj
    const tipo = order.carrier?.trackingIdentifier ?? null

    try {
      const result = await trackSaoMiguel(cnpj, nf, recipientCnpj, tipo)

      if (!result.raw || !Array.isArray(result.raw) || result.raw.length === 0) {
        semDado++
        continue
      }

      const cte = result.raw[0] as Record<string, unknown>
      const rawDelivery = cte.dateandhourdelivery as string | undefined
      if (!rawDelivery) { semDado++; continue }

      // parseBrDate espera dd/MM/yyyy HH:mm
      const parts = rawDelivery.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
      if (!parts) { semDado++; continue }
      const correctDate = new Date(
        parseInt(parts[3]), parseInt(parts[2]) - 1, parseInt(parts[1]),
        parseInt(parts[4]), parseInt(parts[5])
      )
      // Converter de BRT (UTC-3) para UTC
      correctDate.setTime(correctDate.getTime() + 3 * 60 * 60 * 1000)

      const currentDeliveredAt = order.deliveredAt
      // Só atualiza se a diferença for > 1 minuto
      if (currentDeliveredAt && Math.abs(currentDeliveredAt.getTime() - correctDate.getTime()) < 60000) {
        continue
      }

      type StoredEvent = { date: string | null; description: string }
      const events = (Array.isArray(order.trackingEvents) ? order.trackingEvents as StoredEvent[] : []).map((e) =>
        e.description === 'Entrega realizada' ? { ...e, date: correctDate.toISOString() } : e
      )

      await prisma.order.update({
        where: { id: order.id },
        data: { deliveredAt: correctDate, trackingEvents: events },
      })

      console.log(`[BackfillSMDelivery] ${order.orderNumber}: ${currentDeliveredAt?.toLocaleDateString('pt-BR')} → ${correctDate.toLocaleDateString('pt-BR')} ${parts[4]}:${parts[5]}`)
      atualizados++
      await new Promise((r) => setTimeout(r, 500))
    } catch (err) {
      console.error(`[BackfillSMDelivery] Erro ${order.orderNumber}:`, (err as Error).message)
      erros++
    }
  }

  res.json({ message: 'Backfill SAO_MIGUEL deliveredAt concluído', atualizados, semDado, erros, total: orders.length })
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
