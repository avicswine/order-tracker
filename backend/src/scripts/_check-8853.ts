import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const order = await prisma.order.findFirst({
    where: { nfNumber: { in: ['008853', '8853'] } },
    include: { carrier: true }
  })
  if (!order) { console.log('Não encontrado'); return }
  console.log('orderNumber:', order.orderNumber)
  console.log('status:', order.status)
  console.log('carrier:', order.carrier?.name, '| trackingSystem:', order.carrier?.trackingSystem)
  console.log('senderCnpj:', order.senderCnpj)
  console.log('estimatedDelivery:', order.estimatedDelivery?.toLocaleDateString('pt-BR') ?? '-')
  console.log('shippedAt:', order.shippedAt?.toLocaleDateString('pt-BR') ?? '-')
  console.log('lastTracking:', order.lastTracking)
  console.log('lastTrackingAt:', order.lastTrackingAt?.toLocaleDateString('pt-BR') ?? '-')
  await prisma.$disconnect()
}
main().catch(console.error)
