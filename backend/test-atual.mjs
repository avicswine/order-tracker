/**
 * railway run node backend/test-atual.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// Busca pedido AGRO com NF próxima a 3039
const orders = await prisma.order.findMany({
  where: {
    senderCnpj: { contains: '54695386' },
    nfNumber: { in: ['3039', '003039', '3038', '3040'] },
  },
  select: { orderNumber: true, nfNumber: true, status: true, lastTracking: true, hasOccurrence: true },
  orderBy: { nfNumber: 'desc' },
  take: 20,
})

console.log('Pedidos AGRO Atual Cargas PENDING/IN_TRANSIT:')
orders.forEach(o => console.log(`  ${o.orderNumber} | lastTracking: ${o.lastTracking ?? 'null'} | hasOccurrence: ${o.hasOccurrence}`))

await prisma.$disconnect()
