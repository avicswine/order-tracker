/** SÓ LEITURA: mostra os campos de envio/ML de pedidos pelo número da NF. Uso: npx tsx ... 005687 */
import { prisma } from '../lib/prisma'

async function main() {
  const nf = process.argv[2]
  const variantes = [nf, nf.replace(/^0+/, ''), nf.padStart(6, '0'), nf.padStart(9, '0')]
  const pedidos = await prisma.order.findMany({
    where: { OR: [{ nfNumber: { in: variantes } }, { orderNumber: { contains: nf.replace(/^0+/, '') } }] },
    select: { orderNumber: true, nfNumber: true, senderCnpj: true, status: true, carrier: { select: { name: true } },
              shippedAt: true, lastTracking: true, nfIssuedAt: true, mlCompany: true, mlOrderId: true,
              mlShipmentId: true, mlSemEnvio: true, mlShippedNotifiedAt: true, mlEnvioErro: true,
              mlVinculoTentadoAt: true, createdAt: true },
  })
  console.log(JSON.stringify(pedidos, null, 1))
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
