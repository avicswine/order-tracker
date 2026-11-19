import { PrismaClient, OrderStatus, TrackingSystem } from '@prisma/client'
import { trackSSW, trackSenior, trackWithPuppeteer, trackSaoMiguel, trackAtualCargas, trackRodonaves } from '../services/tracking'

const prisma = new PrismaClient()

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.PENDING, OrderStatus.IN_TRANSIT] },
      nfNumber: { not: null },
      senderCnpj: { not: null },
      carrier: {
        trackingSystem: { notIn: [TrackingSystem.NONE, TrackingSystem.BRASPRESS] },
      },
    },
    include: { carrier: true },
    orderBy: { nfIssuedAt: 'asc' },
  })

  console.log(`Total a rastrear: ${orders.length} pedidos\n`)

  let atualizados = 0
  let erros = 0
  let semDados = 0

  for (const order of orders) {
    const carrier = order.carrier!
    const cnpj = order.senderCnpj!
    const nf = order.nfNumber!

    try {
      let result

      if (carrier.trackingSystem === TrackingSystem.SSW) {
        result = await trackSSW(cnpj, nf, carrier.trackingIdentifier ?? undefined)
      } else if (carrier.trackingSystem === TrackingSystem.SENIOR) {
        if (!carrier.trackingIdentifier) { semDados++; continue }
        result = await trackSenior(cnpj, nf, carrier.trackingIdentifier)
      } else if (carrier.trackingSystem === TrackingSystem.PUPPETEER) {
        if (!carrier.trackingIdentifier) { semDados++; continue }
        result = await trackWithPuppeteer(cnpj, nf, carrier.trackingIdentifier)
      } else if (carrier.trackingSystem === TrackingSystem.SAO_MIGUEL) {
        result = await trackSaoMiguel(cnpj, nf, order.recipientCnpj, carrier.trackingIdentifier)
      } else if (carrier.trackingSystem === TrackingSystem.ATUAL_CARGAS) {
        result = await trackAtualCargas(cnpj, nf)
      } else if (carrier.trackingSystem === TrackingSystem.RODONAVES) {
        result = await trackRodonaves(cnpj, nf)
      } else {
        continue
      }

      const novoStatus = result.status
      const lastEvent = result.lastEvent

      console.log(`${order.orderNumber} (${carrier.name}): "${lastEvent}" → ${novoStatus ?? 'sem mapeamento'}`)

      const updates: Record<string, unknown> = { lastTracking: lastEvent, lastTrackingAt: new Date() }

      if (result.events) {
        updates.trackingEvents = result.events.map(e => ({ date: e.date?.toISOString() ?? null, description: e.description }))
      } else if (lastEvent) {
        type StoredEvent = { date: string | null; description: string }
        const existing = Array.isArray(order.trackingEvents) ? (order.trackingEvents as StoredEvent[]) : []
        if (lastEvent !== existing[0]?.description) {
          updates.trackingEvents = [{ date: new Date().toISOString(), description: lastEvent }, ...existing]
        }
      }

      if (result.shippedAt && !order.shippedAt) updates.shippedAt = result.shippedAt
      if (result.estimatedDelivery) updates.estimatedDelivery = result.estimatedDelivery

      if (novoStatus && novoStatus !== order.status) {
        updates.status = novoStatus
        if (novoStatus === OrderStatus.DELIVERED) updates.deliveredAt = new Date()
        await prisma.order.update({
          where: { id: order.id },
          data: { ...updates, statusHistory: { create: { status: novoStatus, note: `Rastreio: ${lastEvent}` } } },
        })
      } else {
        await prisma.order.update({ where: { id: order.id }, data: updates })
      }

      atualizados++
      await new Promise(r => setTimeout(r, 500))
    } catch (e) {
      console.error(`${order.orderNumber}: ERRO — ${(e as Error).message}`)
      erros++
    }
  }

  // Resumo final
  const totalPending = await prisma.order.count({ where: { status: 'PENDING' } })
  const totalTransit = await prisma.order.count({ where: { status: 'IN_TRANSIT' } })
  console.log(`\n=== Concluído ===`)
  console.log(`Atualizados: ${atualizados} | Erros: ${erros} | Sem dados: ${semDados}`)
  console.log(`Banco agora: PENDING ${totalPending} | IN_TRANSIT ${totalTransit}`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
