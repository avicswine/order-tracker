import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Todos os carriers com TRD ou DALFAN no nome
  const carriers = await prisma.carrier.findMany({
    where: { OR: [{ name: { contains: 'TRD' } }, { name: { contains: 'DALFAN' } }] },
  })

  console.log('=== Carriers TRD/Dalfan ===')
  for (const c of carriers) {
    const pedidos = await prisma.order.count({ where: { carrierId: c.id } })
    console.log(JSON.stringify({ ...c, pedidos }, null, 2))
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
