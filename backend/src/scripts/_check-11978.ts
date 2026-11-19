import { prisma } from '../lib/prisma'
async function main() {
  const o = await prisma.order.findFirst({
    where: { nfNumber: '011978' },
    select: { orderNumber: true, status: true, deliveredAt: true, mlCompany: true, mlOrderId: true,
              mlShipmentId: true, mlShippedNotifiedAt: true, mlDeliveredNotifiedAt: true, mlEnvioErro: true },
  })
  console.log(JSON.stringify(o, null, 1))
  const pend = await prisma.order.count({
    where: { mlShipmentId: { not: null },
      OR: [{ status: 'IN_TRANSIT', mlShippedNotifiedAt: null, lastTracking: { not: null } },
           { status: 'DELIVERED', mlDeliveredNotifiedAt: null }] },
  })
  console.log('ainda pendentes de aviso:', pend)
  await prisma.$disconnect()
}
main().catch(async e => { console.error(e); await prisma.$disconnect() })
