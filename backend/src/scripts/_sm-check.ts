import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const orders = await prisma.order.findMany({
    where: { status: { in: ['PENDING', 'IN_TRANSIT'] }, carrier: { trackingSystem: 'SAO_MIGUEL' } },
    include: { carrier: true },
    orderBy: { nfIssuedAt: 'desc' }
  })
  console.log('Total SAO_MIGUEL IN_TRANSIT/PENDING:', orders.length)
  for (const o of orders) {
    console.log(o.orderNumber, '|', o.status, '| prev:', o.estimatedDelivery?.toLocaleDateString('pt-BR') ?? '-')
  }
  await prisma.$disconnect()
}

main().catch(console.error)
