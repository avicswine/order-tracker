import { PrismaClient, OrderStatus } from '@prisma/client'
import { trackSSW } from '../services/tracking'
const prisma = new PrismaClient()

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      status: { in: [OrderStatus.PENDING, OrderStatus.IN_TRANSIT] },
      carrier: { name: { contains: 'ATUAL' } },
      nfNumber: { not: null }, senderCnpj: { not: null },
    },
    include: { carrier: true },
    orderBy: { nfIssuedAt: 'desc' },
  })
  console.log(`Rastreando ${orders.length} pedidos da Atual Cargas via SSW...\n`)

  let atualizados = 0, erros = 0, semDados = 0

  for (const order of orders) {
    try {
      const result = await trackSSW(order.senderCnpj!, order.nfNumber!)

      if (!result.status && !result.lastEvent) { semDados++; continue }

      console.log(`${order.orderNumber}: "${result.lastEvent}" → ${result.status ?? 'sem mapeamento'}`)

      const updates: Record<string, unknown> = { lastTracking: result.lastEvent, lastTrackingAt: new Date() }
      if (result.events) updates.trackingEvents = result.events.map(e => ({ date: e.date?.toISOString() ?? null, description: e.description }))
      if (result.shippedAt && !order.shippedAt) updates.shippedAt = result.shippedAt
      if (result.estimatedDelivery) updates.estimatedDelivery = result.estimatedDelivery

      if (result.status && result.status !== order.status) {
        updates.status = result.status
        if (result.status === OrderStatus.DELIVERED) {
          const deliveredEvent = result.events?.find(e => {
            const t = e.description.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            return t.includes('ENTREGUE') || t.includes('ENTREGA REALIZADA') || t.includes('ENTREGA EFETUADA')
          })
          const eventDate = deliveredEvent?.date ?? result.events?.[0]?.date
          updates.deliveredAt = (eventDate instanceof Date && !isNaN(eventDate.getTime())) ? eventDate : new Date()
        }
        await prisma.order.update({
          where: { id: order.id },
          data: { ...updates, statusHistory: { create: { status: result.status, note: `Rastreio SSW: ${result.lastEvent}` } } }
        })
      } else {
        await prisma.order.update({ where: { id: order.id }, data: updates })
      }
      atualizados++
      await new Promise(r => setTimeout(r, 800))
    } catch (e) {
      console.error(`${order.orderNumber}: ERRO — ${(e as Error).message}`)
      erros++
    }
  }

  console.log(`\n=== Concluído ===`)
  console.log(`Atualizados: ${atualizados} | Sem dados: ${semDados} | Erros: ${erros}`)
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
