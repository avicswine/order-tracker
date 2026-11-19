import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const order = await prisma.order.findFirst({
    where: { orderNumber: 'EQUI-NF-000019' },
    include: { carrier: true },
  })
  console.log(JSON.stringify(order, null, 2))
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
