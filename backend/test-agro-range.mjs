import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const orders = await prisma.order.findMany({
  where: { senderCnpj: { contains: '54695386' } },
  select: { orderNumber: true, nfNumber: true, status: true, shippedAt: true, estimatedDelivery: true, carrier: { select: { name: true } } },
  orderBy: { nfNumber: 'desc' },
  take: 30,
})

console.log('Últimas 30 NFs AGRO no banco:')
orders.forEach(o => console.log(
  `  ${o.orderNumber} | ${o.carrier?.name ?? 'sem carrier'} | status: ${o.status} | enviado: ${o.shippedAt?.toLocaleDateString('pt-BR') ?? '-'} | previsão: ${o.estimatedDelivery?.toLocaleDateString('pt-BR') ?? '-'}`
))

await prisma.$disconnect()
