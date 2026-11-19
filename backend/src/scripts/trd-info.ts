import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const carriers = await prisma.carrier.findMany({ where: { name: { contains: 'TRD' } } })
  console.log('=== Transportadoras TRD ===')
  for (const c of carriers) {
    const total = await prisma.order.count({ where: { carrierId: c.id } })
    const pending = await prisma.order.count({ where: { carrierId: c.id, status: 'PENDING' } })
    console.log(`ID: ${c.id}`)
    console.log(`Nome: ${c.name}`)
    console.log(`CNPJ: ${c.cnpj}`)
    console.log(`Pedidos: ${total} (${pending} pending)`)
    console.log('---')
  }

  // Lista os pedidos pendentes com nfNumber para rastreio
  const pendentes = await prisma.order.findMany({
    where: { status: 'PENDING', carrier: { name: { contains: 'TRD' } } },
    select: { id: true, orderNumber: true, nfNumber: true, nfIssuedAt: true },
    orderBy: { nfIssuedAt: 'asc' },
  })
  console.log(`\n=== Pedidos TRD pendentes (${pendentes.length}) ===`)
  for (const o of pendentes) {
    console.log(`${o.orderNumber}  NF: ${o.nfNumber}  emissão: ${o.nfIssuedAt?.toISOString().slice(0,10) ?? '-'}`)
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
