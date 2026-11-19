import { prisma } from '../lib/prisma'
async function main() {
  const grupos = await prisma.order.groupBy({ by: ['senderCnpj'], _count: true })
  console.log('senderCnpj no banco:')
  grupos.forEach(g => console.log(`  "${g.senderCnpj}" → ${g._count} pedidos`))
  const o = await prisma.order.findFirst({
    where: { nfNumber: '012105' },
    select: { orderNumber: true, senderCnpj: true, status: true, shippedAt: true, deliveredAt: true, lastTracking: true, carrier: { select: { name: true } } },
  })
  console.log('\nNF 012105:', JSON.stringify(o, null, 1))
  await prisma.$disconnect()
}
main().catch(async e => { console.error(e); await prisma.$disconnect() })
