/** Roda a importação do DIFAL de verdade, sem passar pela API. */
import { PrismaClient } from '@prisma/client'
import { loadTokensFromDB, listarEmpresasBling } from './routes/bling'
import { semearAliquotas } from './services/difal/aliquotas'
import { importarNotas } from './services/difal/importar'

const prisma = new PrismaClient()

async function main() {
  await loadTokensFromDB()
  const empresas = listarEmpresasBling()
  console.log('empresas conectadas no Bling:',
    empresas.filter((e) => e.connected).map((e) => e.code).join(', ') || 'NENHUMA')

  const n = await semearAliquotas(prisma)
  console.log(`alíquotas gravadas: ${n}`)

  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  console.log(`\nimportando notas desde ${desde.toISOString().slice(0, 10)}...`)
  const r = await importarNotas(prisma, { desde, limite: 40 })
  for (const e of r) {
    console.log(`\n${e.empresa}: ${e.lidas} lidas · ${e.gravadas} novas · ` +
      `${e.atualizadas} atualizadas · ${e.ignoradas} ignoradas`)
    e.erros.slice(0, 3).forEach((x) => console.log(`   erro: ${x.slice(0, 90)}`))
  }

  const total = await prisma.difalNota.count()
  console.log(`\n--- ${total} notas na tabela ---`)
  const porResp = await prisma.difalNota.groupBy({
    by: ['responsavel'],
    _count: { _all: true },
    _sum: { difalCalculado: true },
  })
  for (const g of porResp) {
    console.log(`   ${g.responsavel.padEnd(10)} ${String(g._count._all).padStart(3)} nota(s) · ` +
      `R$ ${(g._sum.difalCalculado ?? 0).toFixed(2)}`)
  }
  const exemplos = await prisma.difalNota.findMany({
    where: { responsavel: 'NOSSO', difalCalculado: { gt: 0 } },
    take: 5, orderBy: { emitidaEm: 'desc' },
  })
  if (exemplos.length) {
    console.log('\nNotas que exigem guia nossa:')
    for (const e of exemplos) {
      console.log(`   NF ${e.nfNumero} ${e.clienteUf} · nota R$ ${e.valorNota.toFixed(2)} · ` +
        `DIFAL R$ ${e.difalCalculado.toFixed(2)} · ${e.canalNome ?? '—'}`)
    }
  }
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error('FALHOU:', e.message); await prisma.$disconnect(); process.exit(1) })
