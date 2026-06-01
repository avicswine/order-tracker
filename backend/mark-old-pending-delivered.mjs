import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const CUTOFF = new Date('2026-04-01') // NFs emitidas antes de 01/abr com 60+ dias sem rastreio

const orders = await prisma.order.findMany({
  where: {
    status: 'PENDING',
    lastTracking: null,
    shippedAt: null,
    nfIssuedAt: { lt: CUTOFF },
  },
  select: { id: true, orderNumber: true, nfIssuedAt: true, carrier: { select: { name: true } } },
  orderBy: { nfIssuedAt: 'asc' },
})

console.log(`Encontrados: ${orders.length} pedidos PENDING sem rastreio emitidos antes de 01/abr`)
console.log('Primeiros 10:')
orders.slice(0, 10).forEach(o => console.log(`  ${o.orderNumber} | ${o.nfIssuedAt?.toLocaleDateString('pt-BR')} | ${o.carrier?.name ?? 'sem carrier'}`))

if (orders.length === 0) { await prisma.$disconnect(); process.exit(0) }

// Marcar como DELIVERED
let marcados = 0
for (const order of orders) {
  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: 'DELIVERED',
      deliveredAt: new Date(),
      lastTracking: 'Pedido marcado como entregue (NF antiga sem dados de rastreio disponíveis)',
      statusHistory: {
        create: { status: 'DELIVERED', note: 'Marcado automaticamente: NF emitida há mais de 60 dias sem dados de rastreio' }
      }
    }
  })
  marcados++
}

console.log(`\nConcluído: ${marcados} pedidos marcados como ENTREGUE`)
await prisma.$disconnect()
