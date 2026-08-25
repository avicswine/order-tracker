import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { trackSSW, trackSenior, trackWithPuppeteer, trackSaoMiguel, trackAtualCargas, trackRodonaves, trackBraspress, trackModular } from '../services/tracking'
import { OrderStatus, TrackingSystem, Prisma } from '@prisma/client'
import { notifyOrderUpdate, notifyCarrier } from '../services/notifier'
import { criarPendenciaAuto, resolverPendenciasAutoSeEntregue } from '../services/pendencias'

const router = Router()

type ProgressCallback = (data: { current: number; total: number; orderNumber: string; carrier: string; status: string | null }) => void

const TRACKING_CONCURRENCY = 5

// Aviso automático à transportadora só vale para NFs recentes.
// NFs muito antigas podem estar com status de rastreio desatualizado (ex: já entregues
// mas ainda marcadas como atrasadas), então não devem gerar aviso retroativo.
const CARRIER_NOTIFY_MAX_AGE_DAYS = 60

// Atraso só vira pendência de pós-venda com 3+ dias — atrasos curtos costumam se resolver sozinhos
const PENDENCIA_ATRASO_MIN_DIAS = 3

export async function runTrackingSync(onProgress?: ProgressCallback, systems?: TrackingSystem[]): Promise<{ atualizados: number; erros: number; total: number }> {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.PENDING, OrderStatus.IN_TRANSIT] },
      nfNumber: { not: null },
      senderCnpj: { not: null },
      carrier: systems
        ? { trackingSystem: { in: systems } }
        : { trackingSystem: { not: TrackingSystem.NONE } },
    },
    include: { carrier: true },
    orderBy: [
      { status: 'asc' },
      { createdAt: 'desc' },
    ],
  })

  if (orders.length === 0) return { atualizados: 0, erros: 0, total: 0 }

  let atualizados = 0
  let erros = 0

  async function processOne(order: typeof orders[number]): Promise<void> {
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
          return
        }
        result = await trackSenior(cnpj, nf, carrier.trackingIdentifier)
      } else if (carrier.trackingSystem === TrackingSystem.PUPPETEER) {
        if (!carrier.trackingIdentifier) {
          console.warn(`[Tracking] ${order.orderNumber}: PUPPETEER sem portal configurado`)
          return
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
      } else if (carrier.trackingSystem === TrackingSystem.MODULAR) {
        result = await trackModular(cnpj, nf, order.nfKey)
      } else {
        return
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

      // Quando a API não encontrou o pedido (status null), não sobrescreve lastTracking
      // (ex: Atual Cargas remove pedidos entregues da lista, retornando "Não localizado")
      const semDados = result.status === null
      const updates: Record<string, unknown> = {
        lastTrackingAt: new Date(),
        hasOccurrence: result.hasOccurrence ?? false,
      }
      if (!semDados) updates.lastTracking = lastEvent

      if (!semDados) {
        if (result.events) {
          updates.trackingEvents = result.events.map((e) => ({
            date: e.date?.toISOString() ?? null,
            description: e.description,
          }))
        } else if (lastEvent) {
          type StoredEvent = { date: string | null; description: string }
          const existing = Array.isArray(order.trackingEvents)
            ? (order.trackingEvents as StoredEvent[])
            : []
          const mostRecent = existing[0]?.description
          if (lastEvent !== mostRecent) {
            updates.trackingEvents = [{ date: new Date().toISOString(), description: lastEvent }, ...existing]
          }
        }
      }

      // Sobrescreve shippedAt se a nova data for anterior à armazenada (coleta real = evento mais antigo)
      if (result.shippedAt && (!order.shippedAt || result.shippedAt < order.shippedAt)) {
        updates.shippedAt = result.shippedAt
      }
      // Só salva estimatedDelivery se a data (sem hora) for igual ou depois de shippedAt
      // Comparação por dia evita falso bloqueio quando shippedAt tem hora e estimatedDelivery é meia-noite
      const shipped = (result.shippedAt ?? order.shippedAt)
      const toDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      if (result.estimatedDelivery && (!shipped || toDay(result.estimatedDelivery) >= toDay(shipped))) {
        updates.estimatedDelivery = result.estimatedDelivery
      }

      if (novoStatus && novoStatus !== order.status) {
        updates.status = novoStatus
        if (novoStatus === OrderStatus.DELIVERED) {
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

      // Notifica o cliente se lastTracking mudou (fire-and-forget)
      if (!semDados && lastEvent && lastEvent !== order.lastTracking) {
        const estimatedDelivery = (updates.estimatedDelivery as Date | undefined) ?? order.estimatedDelivery
        notifyOrderUpdate({
          id: order.id,
          orderNumber: order.orderNumber,
          nfNumber: order.nfNumber,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          customerPhone: order.customerPhone,
          senderCnpj: order.senderCnpj,
          estimatedDelivery: estimatedDelivery ?? null,
          lastTracking: lastEvent,
          lastTrackingAt: new Date(),
        }).catch(err => console.error(`[Notifier] Erro ao notificar ${order.orderNumber}:`, err))
      }

      // Avisa o responsável da transportadora em ocorrência ou atraso (fire-and-forget)
      // Só para NFs recentes (ver CARRIER_NOTIFY_MAX_AGE_DAYS) — evita disparo retroativo
      // em massa de notas antigas com status possivelmente desatualizado.
      const emissao = order.nfIssuedAt ? new Date(order.nfIssuedAt).getTime() : 0
      const nfRecente = emissao > 0 && (Date.now() - emissao) <= CARRIER_NOTIFY_MAX_AGE_DAYS * 86400000
      if (!semDados && carrier.whatsappResponsavel && nfRecente) {
        const estimatedDelivery = (updates.estimatedDelivery as Date | undefined) ?? order.estimatedDelivery
        const statusFinal = (updates.status as OrderStatus | undefined) ?? order.status
        const entregueOuCancelado = statusFinal === OrderStatus.DELIVERED || statusFinal === OrderStatus.CANCELLED
        const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
        const atrasado = !entregueOuCancelado && estimatedDelivery && new Date(estimatedDelivery) < hoje
        const carrierMin = { name: carrier.name, whatsappResponsavel: carrier.whatsappResponsavel }
        const base = {
          id: order.id, orderNumber: order.orderNumber, nfNumber: order.nfNumber,
          customerName: order.customerName, senderCnpj: order.senderCnpj, recipientCnpj: order.recipientCnpj,
          estimatedDelivery: estimatedDelivery ?? null, lastTracking: lastEvent, carrier: carrierMin,
        }
        if (result.hasOccurrence) {
          notifyCarrier(base, 'OCORRENCIA').catch(err => console.error(`[Notifier] Erro aviso transportadora (ocorrência) ${order.orderNumber}:`, err))
        } else if (atrasado) {
          notifyCarrier(base, 'ATRASO').catch(err => console.error(`[Notifier] Erro aviso transportadora (atraso) ${order.orderNumber}:`, err))
        }
      }

      // Pendências de pós-venda automáticas (mesma janela de recência do aviso à transportadora):
      // ocorrência cria na hora; atraso só com 3+ dias da previsão. Entrega resolve as automáticas.
      if (!semDados && nfRecente) {
        const estimatedDelivery = (updates.estimatedDelivery as Date | undefined) ?? order.estimatedDelivery
        const statusFinal = (updates.status as OrderStatus | undefined) ?? order.status
        const pendBase = {
          id: order.id, nfNumber: order.nfNumber, customerName: order.customerName,
          senderCnpj: order.senderCnpj, lastTracking: lastEvent,
        }
        if (statusFinal === OrderStatus.DELIVERED) {
          resolverPendenciasAutoSeEntregue(order.id, statusFinal).catch(err => console.error(`[Pendencias] Erro ao resolver ${order.orderNumber}:`, err))
        } else if (result.hasOccurrence) {
          criarPendenciaAuto(pendBase, 'OCORRENCIA').catch(err => console.error(`[Pendencias] Erro (ocorrência) ${order.orderNumber}:`, err))
        } else if (statusFinal !== OrderStatus.CANCELLED && estimatedDelivery) {
          const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
          const diasAtraso = Math.floor((hoje.getTime() - new Date(estimatedDelivery).setHours(0, 0, 0, 0)) / 86400000)
          if (diasAtraso >= PENDENCIA_ATRASO_MIN_DIAS) {
            criarPendenciaAuto(pendBase, 'ATRASO').catch(err => console.error(`[Pendencias] Erro (atraso) ${order.orderNumber}:`, err))
          }
        }
      }

      atualizados++
      onProgress?.({ current: atualizados + erros, total: orders.length, orderNumber: order.orderNumber, carrier: carrier.name, status: novoStatus ?? null })
    } catch (err) {
      console.error(`[Tracking] Erro ao rastrear ${order.orderNumber}:`, err)
      erros++
      onProgress?.({ current: atualizados + erros, total: orders.length, orderNumber: order.orderNumber, carrier: carrier.name, status: 'erro' })
    }
  }

  // Processa em lotes paralelos para acelerar o rastreamento
  for (let i = 0; i < orders.length; i += TRACKING_CONCURRENCY) {
    const chunk = orders.slice(i, i + TRACKING_CONCURRENCY)
    await Promise.all(chunk.map(processOne))
  }

  return { atualizados, erros, total: orders.length }
}

// POST /api/tracking/sync — disparo manual (sem progresso)
router.post('/sync', async (_req: Request, res: Response) => {
  const result = await runTrackingSync()
  res.json({ message: 'Rastreamento concluído', ...result })
})

// POST /api/tracking/notify-carrier — dispara aviso ao responsável da transportadora
// APENAS para os pedidos informados (não roda rastreio). Usa o estado atual do pedido
// para decidir o tipo (ocorrência ou atraso). Deduplicado por tipo, igual ao fluxo automático.
router.post('/notify-carrier', async (req: Request, res: Response) => {
  const orderNumbers: unknown = req.body?.orderNumbers
  if (!Array.isArray(orderNumbers) || orderNumbers.length === 0) {
    return res.status(400).json({ error: 'Informe orderNumbers: string[]' })
  }

  const orders = await prisma.order.findMany({
    where: { orderNumber: { in: orderNumbers as string[] } },
    include: { carrier: true },
  })

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const resultados = []

  for (const num of orderNumbers as string[]) {
    const order = orders.find((o) => o.orderNumber === num)
    if (!order) { resultados.push({ orderNumber: num, sent: false, reason: 'nao-encontrado' }); continue }
    if (!order.carrier?.whatsappResponsavel) {
      resultados.push({ orderNumber: num, carrier: order.carrier?.name ?? null, sent: false, reason: 'transportadora-sem-whatsapp' })
      continue
    }

    const entregueOuCancelado = order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED
    const atrasado = !entregueOuCancelado && order.estimatedDelivery && new Date(order.estimatedDelivery) < hoje
    const tipo = order.hasOccurrence ? 'OCORRENCIA' : (atrasado ? 'ATRASO' : null)
    if (!tipo) {
      resultados.push({ orderNumber: num, carrier: order.carrier.name, sent: false, reason: 'sem-ocorrencia-nem-atraso' })
      continue
    }

    const r = await notifyCarrier({
      id: order.id, orderNumber: order.orderNumber, nfNumber: order.nfNumber,
      customerName: order.customerName, senderCnpj: order.senderCnpj, recipientCnpj: order.recipientCnpj,
      estimatedDelivery: order.estimatedDelivery, lastTracking: order.lastTracking,
      carrier: { name: order.carrier.name, whatsappResponsavel: order.carrier.whatsappResponsavel },
    }, tipo)
    resultados.push({ orderNumber: num, carrier: order.carrier.name, tipo, ...r })
  }

  res.json({ resultados })
})

// GET /api/tracking/carrier-notifs — lista os avisos já enviados às transportadoras
// (canal CARRIER_OCORRENCIA / CARRIER_ATRASO), do mais recente ao mais antigo.
router.get('/carrier-notifs', async (_req: Request, res: Response) => {
  const notifs = await prisma.orderNotification.findMany({
    where: { channel: { startsWith: 'CARRIER_' } },
    orderBy: { sentAt: 'desc' },
    include: {
      order: { select: { orderNumber: true, customerName: true, nfIssuedAt: true, carrier: { select: { name: true } } } },
    },
  })

  const lista = notifs.map((n) => ({
    sentAt: n.sentAt,
    tipo: n.channel.replace('CARRIER_', ''),
    sucesso: n.success,
    orderNumber: n.order?.orderNumber ?? null,
    cliente: n.order?.customerName ?? null,
    transportadora: n.order?.carrier?.name ?? null,
    nfEmitida: n.order?.nfIssuedAt ?? null,
    erro: n.error ?? null,
  }))

  res.json({ total: lista.length, avisos: lista })
})

function sseHandler(systems?: TrackingSystem[]) {
  return async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    // Heartbeat a cada 30s para evitar que o proxy do Railway corte a conexão
    // durante esperas longas entre pedidos (Puppeteer, timeouts de API, etc.)
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000)

    try {
      const result = await runTrackingSync((progress) => send('progress', progress), systems)
      send('done', result)
    } catch (err) {
      send('error', { message: String(err) })
    } finally {
      clearInterval(heartbeat)
      res.end()
    }
  }
}

// GET /api/tracking/sync-stream — SSE com progresso em tempo real (todos)
router.get('/sync-stream', sseHandler())

// GET /api/tracking/sync-stream-sm — SSE só para São Miguel
router.get('/sync-stream-sm', sseHandler([TrackingSystem.SAO_MIGUEL]))

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
