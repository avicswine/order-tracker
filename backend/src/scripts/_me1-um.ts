// Dispara os avisos ME1 de UM pedido só (teste controlado antes de ligar o automático).
// Rodar: railway run npx tsx src/scripts/_me1-um.ts <numeroDaNF>
import { prisma } from '../lib/prisma'
import { loadTokensFromDB } from '../routes/bling'
import { vincularVendasMe1, notificarStatusMl, PORTAL_URL, TRACKING_MSG } from '../services/mlEnvios'
import type { MlCompany } from '../services/mercadolivre'

async function main() {
  const nf = process.argv[2]
  if (!nf) { console.log('Informe o número da NF'); return }
  await loadTokensFromDB()

  console.log('Vinculando vendas ME1 aos pedidos...')
  const v = await vincularVendasMe1()
  console.log(`  ${v.me1} ME1 em aberto · ${v.vinculados} vínculos novos\n`)

  const o = await prisma.order.findFirst({
    where: { nfNumber: nf, mlShipmentId: { not: null } },
    select: {
      id: true, orderNumber: true, customerName: true, status: true,
      shippedAt: true, deliveredAt: true, lastTracking: true,
      mlCompany: true, mlShipmentId: true, mlShippedNotifiedAt: true, mlDeliveredNotifiedAt: true,
    },
  })
  if (!o) { console.log(`NF ${nf} não está vinculada a uma venda ME1`); await prisma.$disconnect(); return }

  console.log(`${o.orderNumber} · ${o.customerName}`)
  console.log(`  status: ${o.status} | entregue: ${o.deliveredAt?.toLocaleString('pt-BR') ?? '—'}`)
  console.log(`  envio ML: ${o.mlShipmentId} (${o.mlCompany})`)
  console.log(`  já avisado: a caminho=${o.mlShippedNotifiedAt ? 'sim' : 'não'} entregue=${o.mlDeliveredNotifiedAt ? 'sim' : 'não'}\n`)

  const company = o.mlCompany as MlCompany
  if (!o.mlShippedNotifiedAt) {
    console.log(`→ "a caminho" com tracking_url=${PORTAL_URL}`)
    console.log(`  tracking_number="${TRACKING_MSG}"`)
    await notificarStatusMl(company, o.mlShipmentId!, 'shipped', {
      date: o.shippedAt, comment: o.lastTracking ?? undefined, comTracking: true,
    })
    await prisma.order.update({ where: { id: o.id }, data: { mlShippedNotifiedAt: new Date(), mlEnvioErro: null } })
    console.log('  OK\n')
    await new Promise((r) => setTimeout(r, 2000))
  }
  if (o.status === 'DELIVERED' && !o.mlDeliveredNotifiedAt) {
    console.log('→ "entregue" (finalizador)')
    await notificarStatusMl(company, o.mlShipmentId!, 'delivered', {
      date: o.deliveredAt, comment: o.lastTracking ?? undefined,
    })
    await prisma.order.update({ where: { id: o.id }, data: { mlDeliveredNotifiedAt: new Date(), mlEnvioErro: null } })
    console.log('  OK')
  }
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e?.response?.data ?? e); await prisma.$disconnect() })
