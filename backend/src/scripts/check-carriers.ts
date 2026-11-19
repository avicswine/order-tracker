import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const nomes = ['GARBERG', 'TNT', 'HS MOVERE']
  for (const nome of nomes) {
    const transp = await prisma.carrier.findFirst({ where: { name: { contains: nome } } })
    if (!transp) { console.log(nome + ': não encontrada'); continue }
    const total = await prisma.order.count({ where: { carrierId: transp.id } })
    const pending = await prisma.order.count({ where: { carrierId: transp.id, status: 'PENDING' } })
    console.log(`${transp.name}  — total: ${total} pedidos (${pending} pending)`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
