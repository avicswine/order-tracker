/** Testa gerarLoteDasNotas no banco LOCAL com uma nota fictícia; apaga tudo no final. */
import { PrismaClient } from '@prisma/client'
import { gerarLoteDasNotas, listarGuiasPendentes } from './services/difal/guias'

const prisma = new PrismaClient()
const NF = 'TESTE-GNRE-1'

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) throw new Error('só no banco local')
  await prisma.difalEmitente.upsert({
    where: { empresa: 'TESTE' }, update: {},
    create: { empresa: 'TESTE', cnpj: '47715256000149', razaoSocial: 'EMPRESA TESTE LTDA', endereco: 'RUA X, 1',
      municipioIbge: '11809', uf: 'RS', cep: '99150000' },
  })
  await prisma.difalAliquota.update({ where: { uf: 'PI' }, data: { codigoReceitaGnre: '100102' } })
  const nota = await prisma.difalNota.create({ data: {
    empresa: 'TESTE', nfNumero: NF, emitidaEm: new Date('2026-11-05T12:00:00Z'), clienteNome: 'CONSUMIDOR TESTE',
    clienteUf: 'PI', valorProdutos: 1000, valorNota: 1000, valorComReducao: 1000, difalCalculado: 15,
    difalMetodo: 'carga', responsavel: 'NOSSO', situacao: 'PENDENTE',
    municipioIbgeDestino: '11001', documentoDestinatario: '12345678909' } })

  const pend = await listarGuiasPendentes(prisma, 'TESTE')
  console.log('pendentes TESTE:', pend.map((p) => ({ nf: p.nfNumero, pronta: p.pronta, faltando: p.faltando })))

  const lote = await gerarLoteDasNotas(prisma, [nota.id], new Date('2026-11-18T15:00:00Z'))
  console.log(`lote ${lote.loteId}: ${lote.guias} guia(s), total ${lote.total}\n`)
  console.log(lote.xml)
  const depois = await prisma.difalNota.findUnique({ where: { id: nota.id } })
  console.log('marcada:', depois?.guiaGeradaEm?.toISOString(), depois?.guiaLoteId)
  console.log('pendentes depois:', (await listarGuiasPendentes(prisma, 'TESTE')).length)
  try { await gerarLoteDasNotas(prisma, [nota.id]) } catch (e) { console.log('2ª geração recusada:', (e as Error).message) }

  const loteGravado = await prisma.difalLoteGnre.findUnique({ where: { id: lote.loteId } })
  console.log('lote gravado na tabela:', !!loteGravado, loteGravado?.ambiente, loteGravado?.guias, loteGravado?.total)
  await prisma.difalLoteGnre.delete({ where: { id: lote.loteId } })
  await prisma.difalNota.delete({ where: { id: nota.id } })
  await prisma.difalEmitente.delete({ where: { empresa: 'TESTE' } })
  await prisma.difalAliquota.update({ where: { uf: 'PI' }, data: { codigoReceitaGnre: null } })
  console.log('limpo.')
}
main().catch((e) => { console.error('falhou:', e.message); process.exit(1) }).finally(() => prisma.$disconnect())
