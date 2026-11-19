import { prisma } from '../lib/prisma'
async function main() {
  const avic = await prisma.order.findMany({
    where: { senderCnpj: '47715256000149' },
    orderBy: { nfIssuedAt: 'desc' }, take: 5,
    select: { orderNumber: true, nfNumber: true, nfIssuedAt: true, status: true },
  })
  console.log('AVIC — NFs mais recentes no order-tracker:')
  avic.forEach(o => console.log(`  ${o.orderNumber} (nfNumber="${o.nfNumber}") ${o.nfIssuedAt?.toLocaleDateString('pt-BR')} ${o.status}`))

  // as NFs ME1 existem em QUALQUER formato?
  for (const n of ['012262', '12262', '012105', '12105']) {
    const c = await prisma.order.count({ where: { nfNumber: n } })
    if (c) console.log(`  existe com nfNumber="${n}": ${c}`)
  }
  const carriers = await prisma.carrier.findMany({ select: { name: true, cnpj: true, trackingSystem: true } })
  console.log(`\nTransportadoras cadastradas (${carriers.length}):`)
  carriers.forEach(c => console.log(`  ${c.name} · ${c.cnpj ?? 'sem cnpj'} · ${c.trackingSystem}`))
  await prisma.$disconnect()
}
main().catch(async e => { console.error(e); await prisma.$disconnect() })
