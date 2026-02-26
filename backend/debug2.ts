import { prisma } from './src/lib/prisma'
import { trackSSW, trackSenior } from './src/services/tracking'

async function main() {
  const ordens = await prisma.order.findMany({
    where: {
      carrier: { name: { in: ['B. TRANSPORTES LTDA', 'MENGUE EXPRESS', 'TRD TRANSP RODOV DALFAN LTDA'] } },
      nfNumber: { not: null },
      senderCnpj: { not: null },
    },
    select: {
      orderNumber: true, nfNumber: true, senderCnpj: true,
      carrier: { select: { name: true, trackingSystem: true, trackingIdentifier: true } },
    },
    take: 6,
    orderBy: { orderNumber: 'desc' },
  })

  for (const o of ordens) {
    const carrier = o.carrier!
    console.log(`\n=== ${o.orderNumber} (${carrier.name} / ${carrier.trackingSystem}) ===`)
    try {
      if (carrier.trackingSystem === 'SSW') {
        const r = await trackSSW(o.senderCnpj!, o.nfNumber!, carrier.trackingIdentifier ?? undefined)
        console.log('shippedAt:', r.shippedAt)
        console.log('estimatedDelivery:', r.estimatedDelivery)
        console.log('lastEvent:', r.lastEvent)
        console.log('status:', r.status)
      } else if (carrier.trackingSystem === 'SENIOR') {
        const r = await trackSenior(o.senderCnpj!, o.nfNumber!, carrier.trackingIdentifier!)
        console.log('shippedAt:', r.shippedAt)
        console.log('estimatedDelivery:', r.estimatedDelivery)
        console.log('lastEvent:', r.lastEvent)
        console.log('status:', r.status)
      }
    } catch (e) {
      console.error('ERRO:', (e as Error).message)
    }
    await new Promise(r => setTimeout(r, 500))
  }

  await prisma.$disconnect()
}

main()
