// Diagnóstico: por que as NFs de vendas ME1 não estão no order-tracker?
import axios from 'axios'
import { prisma } from '../lib/prisma'
import { loadTokensFromDB } from '../routes/bling'

async function main() {
  await loadTokensFromDB()
  const ultimas = await prisma.order.findMany({
    orderBy: { nfIssuedAt: 'desc' }, take: 3,
    select: { orderNumber: true, nfIssuedAt: true, createdAt: true },
  })
  console.log('NFs mais recentes no order-tracker:')
  ultimas.forEach(o => console.log(`  ${o.orderNumber} · emitida ${o.nfIssuedAt?.toLocaleDateString('pt-BR')} · importada ${o.createdAt.toLocaleDateString('pt-BR')}`))

  const t = await prisma.blingToken.findUnique({ where: { companyKey: 'avic' } })
  if (!t) return
  const H = { headers: { Authorization: `Bearer ${t.accessToken}` }, timeout: 30000 }
  // transportadora das NFs ME1 (define se o order-tracker as importaria)
  for (const num of ['012262', '012105']) {
    const { data } = await axios.get(`https://api.bling.com.br/Api/v3/nfe?numero=${num}`, H)
    const nf = data?.data?.[0]
    if (!nf) { console.log(`\nNF ${num}: não achada na listagem`); continue }
    const { data: det } = await axios.get(`https://api.bling.com.br/Api/v3/nfe/${nf.id}`, H)
    const d = det?.data
    console.log(`\nNF ${num} (id ${nf.id}) situacao=${d?.situacao}`)
    console.log(`  transportador: ${JSON.stringify(d?.transporte?.transportador ?? null)}`)
    console.log(`  volumes: ${JSON.stringify((d?.transporte?.volumes ?? []).slice(0,1))}`)
  }
  await prisma.$disconnect()
}
main().catch(async e => { console.error(e?.response?.data ?? e); await prisma.$disconnect() })
