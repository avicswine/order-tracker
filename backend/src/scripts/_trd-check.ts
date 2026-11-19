import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const order = await prisma.order.findFirst({
    where: { nfNumber: '009330', carrier: { name: { contains: 'TRD' } } },
    include: { carrier: true }
  })
  if (!order) { console.log('Não encontrado'); return }
  console.log('orderNumber:', order.orderNumber)
  console.log('status:', order.status)
  console.log('estimatedDelivery (raw):', order.estimatedDelivery)
  console.log('estimatedDelivery (pt-BR):', order.estimatedDelivery?.toLocaleDateString('pt-BR'))
  console.log('estimatedDelivery (ISO):', order.estimatedDelivery?.toISOString())
  console.log('carrier:', order.carrier?.name, '| trackingSystem:', order.carrier?.trackingSystem, '| tenant:', order.carrier?.trackingIdentifier)
  await prisma.$disconnect()
}
main().catch(console.error)
