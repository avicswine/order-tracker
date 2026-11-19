/** Diagnóstico SÓ LEITURA de uma venda ME1: estado no ML, NF no Bling e pedido no order-tracker.
 *  Uso: npx tsx src/scripts/_me1-diagnostico.ts <agro|avic> <orderIdML> */
import axios from 'axios'
import { prisma } from '../lib/prisma'
import { mlAuth, type MlCompany } from '../services/mercadolivre'
import { cnpjVariantes } from '../services/mlEnvios'
import { buscarNfsPorNumerosLoja, numeroPedidoLojaDaNf } from '../routes/bling'

const ML_API = 'https://api.mercadolibre.com'

async function main() {
  const company = (process.argv[2] || 'agro') as MlCompany
  const oid = process.argv[3]
  const auth = await mlAuth(company)
  console.log(`conta ML ${company}: ${auth ? 'autorizada' : 'NÃO AUTORIZADA'}`)
  if (!auth) return
  const { data: order } = await axios.get(`${ML_API}/orders/${oid}`, auth.H)
  const { data: ship } = await axios.get(`${ML_API}/orders/${oid}/shipments`, auth.H).catch(() => ({ data: null }))
  console.log(`venda ${oid}: status=${order.status} pack=${order.pack_id} criada=${order.date_created}`)
  console.log(`shipment: id=${ship?.id} mode=${ship?.mode} status=${ship?.status}/${ship?.substatus}`)

  const blingKey = company === 'agro' ? 'agrogranja' : 'avic'
  const nfs = await buscarNfsPorNumerosLoja(blingKey, [oid, String(order.pack_id ?? '')].filter(Boolean))
  console.log('NF no Bling pelo pedido da loja:', Object.fromEntries(nfs))

  const pedidos = await prisma.order.findMany({
    where: { OR: [{ mlOrderId: oid }, { nfNumber: { in: [...nfs.values()] } }] },
    select: { orderNumber: true, nfNumber: true, senderCnpj: true, status: true, shippedAt: true,
              lastTracking: true, mlCompany: true, mlOrderId: true, mlShipmentId: true,
              mlShippedNotifiedAt: true, mlEnvioErro: true, mlVinculoTentadoAt: true, nfIssuedAt: true },
  })
  console.log('pedidos no order-tracker:', JSON.stringify(pedidos, null, 1))
  for (const p of pedidos) {
    console.log(`CNPJ ${p.senderCnpj} casa com ${company}?`, cnpjVariantes(company).includes(p.senderCnpj ?? ''))
    if (p.nfNumber) console.log(`numeroPedidoLoja da NF ${p.nfNumber}:`, await numeroPedidoLojaDaNf(blingKey, p.nfNumber))
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e?.response?.data ?? e); process.exit(1) })
