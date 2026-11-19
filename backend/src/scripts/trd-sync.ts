import { PrismaClient, OrderStatus } from '@prisma/client'
import { trackSenior } from '../services/tracking'

const prisma = new PrismaClient()

async function main() {
  const orders = await prisma.order.findMany({
    where: { status: 'PENDING', carrier: { name: { contains: 'TRD' } } },
    include: { carrier: true },
    orderBy: { nfIssuedAt: 'asc' },
  })

  console.log(`Rastreando ${orders.length} pedidos TRD pendentes...\n`)

  for (const order of orders) {
    const tenant = order.carrier!.trackingIdentifier!
    try {
      const result = await trackSenior(order.senderCnpj!, order.nfNumber!, tenant)
      const novoStatus = result.status
      const lastEvent = result.lastEvent

      console.log(`${order.orderNumber}: "${lastEvent}" → ${novoStatus ?? 'sem mapeamento'}${result.estimatedDelivery ? ' | prev: ' + result.estimatedDelivery.toLocaleDateString('pt-BR') : ''}`)

      const updates: Record<string, unknown> = {
        lastTracking: lastEvent,
        lastTrackingAt: new Date(),
      }

      if (result.events) {
        updates.trackingEvents = result.events.map(e => ({ date: e.date?.toISOString() ?? null, description: e.description }))
      }
      if (result.shippedAt && !order.shippedAt) updates.shippedAt = result.shippedAt
      if (result.estimatedDelivery) updates.estimatedDelivery = result.estimatedDelivery

      if (novoStatus && novoStatus !== order.status) {
        updates.status = novoStatus
        if (novoStatus === OrderStatus.DELIVERED) updates.deliveredAt = new Date()
        await prisma.order.update({
          where: { id: order.id },
          data: {
            ...updates,
            statusHistory: { create: { status: novoStatus, note: `Rastreio TRD: ${lastEvent}` } },
          },
        })
      } else {
        await prisma.order.update({ where: { id: order.id }, data: updates })
      }

      await new Promise(r => setTimeout(r, 600))
    } catch (e) {
      console.error(`${order.orderNumber}: ERRO —`, (e as Error).message)
    }
  }

  // Resumo
  const pendentesRestantes = await prisma.order.count({ where: { status: 'PENDING', carrier: { name: { contains: 'TRD' } } } })
  const emTransito = await prisma.order.count({ where: { status: 'IN_TRANSIT', carrier: { name: { contains: 'TRD' } } } })
  const entregues = await prisma.order.count({ where: { status: 'DELIVERED', carrier: { name: { contains: 'TRD' } } } })
  console.log(`\nResumo TRD: PENDING ${pendentesRestantes} | IN_TRANSIT ${emTransito} | DELIVERED ${entregues}`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
