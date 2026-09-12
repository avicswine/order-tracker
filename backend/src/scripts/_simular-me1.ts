// SIMULAÇÃO ME1 — somente leitura. Não escreve nada nos pedidos nem notifica o Mercado
// Livre. Mostra quais vendas ME1 receberiam "a caminho"/"entregue" com a automação ligada.
// Usa as funções oficiais do projeto (o refresh de token do ML é rotativo e precisa ser
// persistido — por isso não reimplementamos a autenticação aqui).
// Rodar: railway run npx tsx src/scripts/_simular-me1.ts
import axios from 'axios'
import { prisma } from '../lib/prisma'
import { ML_COMPANIES, mlAuth, type MlCompany } from '../services/mercadolivre'
import { cnpjVariantes } from '../services/mlEnvios'
import { loadTokensFromDB, buscarNfsPorNumerosLoja } from '../routes/bling'

const ML_API = 'https://api.mercadolibre.com'
const DIAS = 45
const COMPANY_BLING_KEY: Record<MlCompany, string> = { avic: 'avic', agro: 'agrogranja' }
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms))
const dt = (x: Date | null) => (x ? x.toLocaleDateString('pt-BR') : '—')

async function main() {
  await loadTokensFromDB()
  const desde = new Date(Date.now() - DIAS * 86400_000).toISOString()
  let aShipped = 0, aDelivered = 0, semNf = 0, semPedido = 0, semRastreio = 0

  for (const company of ML_COMPANIES) {
    const auth = await mlAuth(company)
    if (!auth) { console.log(`\n${company.toUpperCase()}: sem token do ML`); continue }

    // 1) vendas recentes da conta
    const orders: { id: string; packId: string | null }[] = []
    for (let offset = 0; offset < 200; offset += 50) {
      const { data } = await axios.get(`${ML_API}/orders/search`, {
        ...auth.H,
        params: { seller: auth.userId, 'order.date_created.from': desde, sort: 'date_desc', offset, limit: 50 },
      })
      const res = data?.results ?? []
      for (const o of res) orders.push({ id: String(o.id), packId: o.pack_id ? String(o.pack_id) : null })
      if (res.length < 50) break
      await dorme(300)
    }

    // 2) só ME1 ainda em aberto no ML
    const me1: { orderId: string; packId: string | null; shipId: string; status: string; sub: string | null }[] = []
    for (const o of orders) {
      try {
        const { data } = await axios.get(`${ML_API}/orders/${o.id}/shipments`, auth.H)
        if (data?.id && data.mode === 'me1' && data.status !== 'delivered' && data.status !== 'not_delivered') {
          me1.push({
            orderId: o.id, packId: o.packId, shipId: String(data.id),
            status: String(data.status ?? ''), sub: data.substatus ?? null,
          })
        }
      } catch { /* venda sem envio */ }
      await dorme(110)
    }

    console.log(`\n${'='.repeat(76)}`)
    console.log(`${company.toUpperCase()}: ${orders.length} vendas nos últimos ${DIAS} dias · ${me1.length} ME1 em aberto`)
    if (me1.length === 0) continue

    // 3) numeroLoja (order/pack id) → número da NF, pelo Bling
    const alvos: string[] = []
    me1.forEach((m) => { alvos.push(m.orderId); if (m.packId) alvos.push(m.packId) })
    const nfPorLoja = await buscarNfsPorNumerosLoja(COMPANY_BLING_KEY[company], alvos, DIAS + 15)

    // 4) casa com o pedido do order-tracker e mostra o que seria enviado
    for (const m of me1) {
      const nf = nfPorLoja.get(m.orderId) ?? (m.packId ? nfPorLoja.get(m.packId) : undefined)
      const cab = `  venda ${m.orderId} · envio ${m.shipId} [${m.status}${m.sub ? '/' + m.sub : ''}]`
      if (!nf) { semNf++; console.log(`${cab}\n      sem NF no Bling ainda — nada a avisar`); continue }
      const order = await prisma.order.findFirst({
        where: { nfNumber: nf, senderCnpj: { in: cnpjVariantes(company) } },
        select: { orderNumber: true, customerName: true, status: true, shippedAt: true, deliveredAt: true, lastTracking: true },
      })
      if (!order) { semPedido++; console.log(`${cab}\n      NF ${nf} não está no order-tracker`); continue }

      const quem = `NF ${nf} · ${order.orderNumber} · ${order.customerName.slice(0, 34)}`
      if (order.status === 'DELIVERED') {
        aShipped++; aDelivered++
        console.log(`${cab}\n      ${quem}\n      ENTREGUE ${dt(order.deliveredAt)} → enviaria "a caminho" (+portal) e depois "entregue"`)
      } else if (order.status === 'IN_TRANSIT' && order.lastTracking) {
        aShipped++
        console.log(`${cab}\n      ${quem}\n      em trânsito desde ${dt(order.shippedAt)} → enviaria "a caminho" + link do portal`)
        console.log(`      último evento: ${order.lastTracking}`)
      } else {
        semRastreio++
        console.log(`${cab}\n      ${quem}\n      ${order.status} sem rastreio — aguarda o CT-e da transportadora`)
      }
    }
  }

  console.log(`\n${'='.repeat(76)}`)
  console.log('RESUMO — SIMULAÇÃO, nada foi enviado ao Mercado Livre')
  console.log(`  avisos "a caminho" a enviar : ${aShipped}`)
  console.log(`  avisos "entregue" a enviar  : ${aDelivered}`)
  console.log(`  ME1 ainda sem NF no Bling   : ${semNf}`)
  console.log(`  NF fora do order-tracker    : ${semPedido}`)
  console.log(`  faturado, aguardando CT-e   : ${semRastreio}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e?.response?.data ?? e)
  await prisma.$disconnect()
})
