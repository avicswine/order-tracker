// Roda o ciclo ME1 (vincula + notifica o ML). dryRun quando receber "--simular".
// Rodar: railway run npx tsx src/scripts/_me1-ciclo.ts [--simular]
import { loadTokensFromDB } from '../routes/bling'
import { cicloEnviosMl } from '../services/mlEnvios'
import { prisma } from '../lib/prisma'

async function main() {
  const dryRun = process.argv.includes('--simular')
  await loadTokensFromDB()
  console.log(dryRun ? '— SIMULAÇÃO —' : '— DISPARO REAL —')
  const r = await cicloEnviosMl(dryRun)
  console.log(`vínculos novos: ${r.vinculados} · ME1 em aberto: ${r.me1} · avisos: ${r.processados}`)
  r.resultados.forEach((x) =>
    console.log(`  ${x.ok ? 'OK  ' : 'ERRO'} ${x.orderNumber} NF ${x.nfNumber} → ${x.acao}${x.erro ? ' :: ' + x.erro : ''}`))
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e?.response?.data ?? e); await prisma.$disconnect() })
