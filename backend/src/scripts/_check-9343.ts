import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  // Todas as carriers com ATUAL no nome
  const carriers = await prisma.carrier.findMany({ where: { name: { contains: 'ATUAL' } } })
  for (const c of carriers) {
    const count = await prisma.order.count({ where: { carrierId: c.id } })
    console.log(c.name, '| sistema:', c.trackingSystem, '| pedidos:', count)
  }
  // Atualiza todas para SSW
  const updated = await prisma.carrier.updateMany({
    where: { name: { contains: 'ATUAL' }, trackingSystem: 'NONE' },
    data: { trackingSystem: 'SSW', trackingIdentifier: null }
  })
  console.log('\nAtualizadas para SSW:', updated.count)
  await prisma.$disconnect()
}
main().catch(console.error)
