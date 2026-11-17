/**
 * Conserta os pedidos gravados com a chave de empresa do BLING no campo do MERCADO LIVRE.
 *
 * O campo `mlCompany` precisa ter a chave do ML (avic/agro/equi). Até 17/11/2026 ele
 * recebia a chave do Bling (avic/agrogranja/equipage): com isso o notifier tentava
 * responder como "agrogranja", o ML não reconhecia a conta e o comprador de Agrogranja e
 * Equipage NÃO recebia aviso nenhum de rastreio. AVIC não era afetada porque lá as duas
 * chaves são iguais.
 *
 * Simulação é o padrão. Para gravar de verdade:
 *   npx tsx src/scripts/corrigirMlCompany.ts --aplicar
 */
import { prisma } from '../lib/prisma'

const DE_PARA: Record<string, string> = { agrogranja: 'agro', equipage: 'equi' }

async function main(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar')
  console.log(aplicar ? '>>> GRAVANDO <<<' : '(simulação — nada será alterado)\n')

  let total = 0
  for (const [errada, certa] of Object.entries(DE_PARA)) {
    const quantos = await prisma.order.count({ where: { mlCompany: errada } })
    total += quantos
    console.log(`${errada} -> ${certa}: ${quantos} pedido(s)`)
    if (aplicar && quantos) {
      const r = await prisma.order.updateMany({
        where: { mlCompany: errada }, data: { mlCompany: certa },
      })
      console.log(`   corrigidos: ${r.count}`)
    }
  }

  const ok = await prisma.order.groupBy({
    by: ['mlCompany'], _count: true, where: { mlCompany: { not: null } },
  })
  console.log('\nComo está agora:')
  for (const l of ok) console.log(`  ${l.mlCompany}: ${l._count}`)
  if (!aplicar && total) console.log(`\n${total} pedido(s) a corrigir. Rode com --aplicar.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
