/**
 * Escreve a NOTA nas vendas "combinar entrega" que já existem.
 *
 * O notifier passa a gravar sozinho nas vendas novas; este script é o mutirão das
 * antigas, que o José já atendeu e estão sem nota (ou com a nota escrita à mão).
 *
 *   npx tsx src/scripts/notasCombinarEntrega.ts              # SIMULA (padrão)
 *   npx tsx src/scripts/notasCombinarEntrega.ts --limite 1 --aplicar
 *   npx tsx src/scripts/notasCombinarEntrega.ts --aplicar
 *   ... --todas   inclui as já entregues (por padrão só as que ainda não chegaram: cada venda
 *                 custa 2 chamadas ao ML, e a conta do ML já foi bloqueada)
 *
 * Nota escrita à mão que não seja a previsão de entrega é mantida, nunca apagada.
 *
 * ATENÇÃO: escreve no Mercado Livre. Rode a simulação, confira a lista, e faça a
 * primeira execução real com --limite 1.
 */
import { prisma } from '../lib/prisma'
import { mlGravarNota, ML_COMPANIES, type MlCompany } from '../services/mercadolivre'
import { notaDaVenda } from '../services/notifier'

const aplicar = process.argv.includes('--aplicar')
const todas = process.argv.includes('--todas')
const iLimite = process.argv.indexOf('--limite')
const limite = iLimite >= 0 ? Number(process.argv[iLimite + 1]) : undefined
if (limite !== undefined && !(Number.isInteger(limite) && limite > 0)) {
  console.error('--limite precisa de um número inteiro maior que zero (ex.: --limite 1)')
  process.exit(1)
}

async function main(): Promise<void> {
  const vendas = await prisma.order.findMany({
    where: {
      mlSemEnvio: true,
      mlOrderId: { not: null },
      mlCompany: { not: null },
      status: todas ? { not: 'CANCELLED' } : { in: ['PENDING', 'IN_TRANSIT'] },
      nfNumber: { not: null },
    },
    select: {
      orderNumber: true, mlOrderId: true, mlCompany: true, nfNumber: true,
      status: true, estimatedDelivery: true, deliveredAt: true,
      carrier: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limite,
  })

  console.log(`${aplicar ? 'APLICANDO' : 'SIMULAÇÃO'} — ${vendas.length} venda(s) "combinar entrega"\n`)

  let gravadas = 0, vazias = 0, falhas = 0
  for (const v of vendas) {
    const nota = notaDaVenda(v)
    if (!nota) {
      vazias++
      console.log(`${v.orderNumber}: (sem dado para a nota — pulado)`)
      continue
    }
    if (!ML_COMPANIES.includes(v.mlCompany as MlCompany)) {
      falhas++
      console.log(`${v.orderNumber}: empresa "${v.mlCompany}" não é conta do ML — pulado`)
      continue
    }
    if (!aplicar) {
      console.log(`${v.orderNumber}: "${nota}"`)
      continue
    }
    const r = await mlGravarNota(v.mlCompany as MlCompany, v.mlOrderId!, nota)
    console.log(`${v.orderNumber}: ${r} — "${nota}"`)
    if (r === 'falhou') falhas++
    else if (r !== 'mantida') gravadas++
    await new Promise((r2) => setTimeout(r2, 400))   // a conta do ML já foi bloqueada
  }

  console.log(`\n${vendas.length} venda(s) · ${vazias} sem dado`
    + (aplicar ? ` · ${gravadas} gravada(s) · ${falhas} falha(s)` : ''))
  if (!aplicar) console.log('\n(simulação — nada foi escrito no Mercado Livre)')
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
