import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const carrier = await prisma.carrier.findFirst({ where: { trackingSystem: 'ATUAL_CARGAS' } })
  if (!carrier) { console.log('Carrier não encontrada'); return }
  console.log('Carrier:', carrier.name, '| sistema atual:', carrier.trackingSystem)

  await prisma.carrier.update({
    where: { id: carrier.id },
    data: { trackingSystem: 'SSW', trackingIdentifier: null }
  })
  console.log('Atualizado para SSW')

  const pending = await prisma.order.count({
    where: { carrierId: carrier.id, status: { in: ['PENDING', 'IN_TRANSIT'] } }
  })
  console.log(`Pedidos PENDING/IN_TRANSIT a rastrear: ${pending}`)
  await prisma.$disconnect()
}
main().catch(console.error)
