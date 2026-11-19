import { PrismaClient, OrderStatus, TrackingSystem } from '@prisma/client'
import { trackSaoMiguel } from '../services/tracking'

const prisma = new PrismaClient()

function isDeliveredText(desc: string): boolean {
  const t = desc.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return t.includes('ENTREGUE') || t.includes('ENTREGA REALIZADA') || t.includes('ENTREGA EFETUADA') || t.includes('OCORRENCIA DE ENTREGA')
}

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.PENDING, OrderStatus.IN_TRANSIT] },
      nfNumber: { not: null },
      senderCnpj: { not: null },
      carrier: { trackingSystem: TrackingSystem.SAO_MIGUEL },
    },
    include: { carrier: true },
    orderBy: { nfIssuedAt: 'asc' },
  })

  console.log(`Total São Miguel a rastrear: ${orders.length}\n`)

  let atualizados = 0
  let erros = 0

  for (const order of orders) {
    const carrier = order.carrier!
    const cnpj = order.senderCnpj!
    const nf = order.nfNumber!

    try {
      const result = await trackSaoMiguel(cnpj, nf, order.recipientCnpj, carrier.trackingIdentifier)

      let novoStatus = result.status
      let lastEvent = result.lastEvent

      // Fix: se retornou IN_TRANSIT mas há evento de entrega no histórico, prevalece DELIVERED
      if (novoStatus === OrderStatus.IN_TRANSIT && result.events && result.events.length > 0) {
        const deliveredEvent = result.events.find(e => isDeliveredText(e.description))
        if (deliveredEvent) {
          novoStatus = OrderStatus.DELIVERED
          lastEvent = deliveredEvent.description
          console.log(`  ⚠️  Evento pós-entrega detectado — usando DELIVERED (${deliveredEvent.description} em ${deliveredEvent.date?.toLocaleDateString('pt-BR') ?? '?'})`)
        }
      }

      console.log(`${order.orderNumber}: "${lastEvent}" → ${novoStatus ?? 'sem mapeamento'}`)

      const updates: Record<string, unknown> = { lastTracking: lastEvent, lastTrackingAt: new Date() }

      if (result.events) {
        updates.trackingEvents = result.events.map(e => ({ date: e.date?.toISOString() ?? null, description: e.description }))
      }

      if (result.shippedAt && !order.shippedAt) updates.shippedAt = result.shippedAt
      if (result.estimatedDelivery) updates.estimatedDelivery = result.estimatedDelivery

      if (novoStatus && novoStatus !== order.status) {
        updates.status = novoStatus
        if (novoStatus === OrderStatus.DELIVERED) {
          // Usa a data do evento de entrega real (não events[0] que pode ser pós-entrega)
          const deliveredEvent = result.events?.find(e => isDeliveredText(e.description))
          const eventDate = deliveredEvent?.date ?? result.events?.[0]?.date
          updates.deliveredAt = (eventDate instanceof Date && !isNaN(eventDate.getTime())) ? eventDate : new Date()
          console.log(`  ✅ deliveredAt: ${(updates.deliveredAt as Date).toLocaleDateString('pt-BR')}`)
        }
        await prisma.order.update({
          where: { id: order.id },
          data: { ...updates, statusHistory: { create: { status: novoStatus, note: `Rastreio SM: ${lastEvent}` } } },
        })
      } else {
        await prisma.order.update({ where: { id: order.id }, data: updates })
      }

      atualizados++
      await new Promise(r => setTimeout(r, 1000))
    } catch (e) {
      console.error(`${order.orderNumber}: ERRO — ${(e as Error).message}`)
      erros++
    }
  }

  console.log(`\n=== Concluído ===`)
  console.log(`Atualizados: ${atualizados} | Erros: ${erros}`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
