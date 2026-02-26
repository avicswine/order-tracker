import { prisma } from './src/lib/prisma'

async function main() {
  const orders = await prisma.order.findMany({
    include: { carrier: { select: { name: true, trackingSystem: true } } },
    orderBy: { orderNumber: 'desc' },
  })

  console.log('NF        | Transportadora                        | Sistema       | shippedAt    | estimatedDelivery | status')
  console.log('-'.repeat(115))
  for (const o of orders) {
    const c = o.carrier
    const shipped = o.shippedAt ? o.shippedAt.toLocaleDateString('pt-BR') : 'NULL      '
    const estimated = o.estimatedDelivery ? o.estimatedDelivery.toLocaleDateString('pt-BR') : 'NULL      '
    console.log(
      `${(o.nfNumber ?? '-').padEnd(9)} | ${(c?.name ?? 'sem carrier').padEnd(37)} | ${(c?.trackingSystem ?? '-').padEnd(13)} | ${shipped.padEnd(12)} | ${estimated.padEnd(17)} | ${o.status}`
    )
  }

  await prisma.$disconnect()
}

main()
