import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const sample = await prisma.order.findMany({
  select: { orderNumber: true, senderCnpj: true, nfNumber: true, shippedAt: true, estimatedDelivery: true, carrier: { select: { name: true } } },
  orderBy: { createdAt: 'desc' },
  take: 10,
})

sample.forEach(o => console.log(
  `${o.orderNumber} | CNPJ: "${o.senderCnpj}" | enviado: ${o.shippedAt?.toLocaleDateString('pt-BR') ?? '-'} | previsão: ${o.estimatedDelivery?.toLocaleDateString('pt-BR') ?? '-'}`
))

await prisma.$disconnect()
