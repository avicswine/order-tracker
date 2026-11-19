import { PrismaClient, OrderStatus } from '@prisma/client'
import { trackSenior } from '../services/tracking'
const prisma = new PrismaClient()
async function main() {
  const order = await prisma.order.findFirst({
    where: { nfNumber: '009330', carrier: { name: { contains: 'TRD' } } },
    include: { carrier: true }
  })
  if (!order) { console.log('Não encontrado'); return }
  const result = await trackSenior(order.senderCnpj!, order.nfNumber!, order.carrier!.trackingIdentifier!)
  console.log('status:', result.status)
  console.log('lastEvent:', result.lastEvent)
  console.log('estimatedDelivery:', result.estimatedDelivery?.toLocaleDateString('pt-BR'))
  console.log('estimatedDelivery ISO:', result.estimatedDelivery?.toISOString())
  const updates: Record<string, unknown> = { lastTracking: result.lastEvent, lastTrackingAt: new Date() }
  if (result.estimatedDelivery) updates.estimatedDelivery = result.estimatedDelivery
  if (result.events) updates.trackingEvents = result.events.map(e => ({ date: e.date?.toISOString() ?? null, description: e.description }))
  await prisma.order.update({ where: { id: order.id }, data: updates })
  console.log('\nAtualizado no banco.')
  await prisma.$disconnect()
}
main().catch(console.error)
