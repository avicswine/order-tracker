/**
 * Prévia das notas das vendas ML "combinar entrega" que a próxima rodada de rastreio vai
 * gravar (só lê o banco; quem grava no ML é a rodada, em services/notasCombinarEntrega.ts).
 *
 *   npx tsx src/scripts/notasCombinarEntrega.ts
 */
import { prisma } from '../lib/prisma'
import { notasParaAtualizar } from '../services/notasCombinarEntrega'

async function main(): Promise<void> {
  const notas = await notasParaAtualizar()
  for (const v of notas) console.log(`${v.orderNumber}: "${v.nota}"`)
  console.log(`\n${notas.length} nota(s) para gravar ou atualizar (prévia — nada foi escrito no Mercado Livre)`)
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
