/** SÓ LEITURA: pedidos recentes da AGRO no order-tracker (para achar a NF 5687). */
import { prisma } from '../lib/prisma'
async function main() {
  const r = await prisma.order.findMany({
    where: { OR: [{ senderCnpj: '54695386000122' }, { senderCnpj: '54.695.386/0001-22' }], createdAt: { gte: new Date('2026-09-12') } },
    select: { orderNumber: true, nfNumber: true, status: true, shippedAt: true, mlShipmentId: true, mlVinculoTentadoAt: true, carrierId: true },
    orderBy: { nfNumber: 'desc' }, take: 25,
  })
  console.log(r.map((o) => `${o.orderNumber} nf=${o.nfNumber} ${o.status} enviado=${o.shippedAt?.toISOString().slice(0, 10)} ship=${o.mlShipmentId} tentado=${o.mlVinculoTentadoAt?.toISOString().slice(0, 16)}`).join('\n'))
  const total = await prisma.order.count({ where: { nfNumber: { contains: '5687' } } })
  console.log('qualquer pedido com 5687 na NF:', total)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
