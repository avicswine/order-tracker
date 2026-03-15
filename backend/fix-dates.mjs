/**
 * Limpa estimatedDelivery onde está antes de shippedAt (dado inválido)
 * railway run node backend/fix-dates.mjs
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const orders = await prisma.order.findMany({
  where: {
    shippedAt: { not: null },
    estimatedDelivery: { not: null },
  },
  select: { id: true, orderNumber: true, shippedAt: true, estimatedDelivery: true },
})

let corrigidos = 0
for (const o of orders) {
  if (o.estimatedDelivery <= o.shippedAt) {
    await prisma.order.update({ where: { id: o.id }, data: { estimatedDelivery: null } })
    console.log(`✓ ${o.orderNumber}: previsão ${o.estimatedDelivery.toLocaleDateString('pt-BR')} < enviado ${o.shippedAt.toLocaleDateString('pt-BR')} → previsão removida`)
    corrigidos++
  }
}

console.log(`\nCorrigidos: ${corrigidos}`)
await prisma.$disconnect()
