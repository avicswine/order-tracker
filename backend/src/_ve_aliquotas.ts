import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const todas = await prisma.difalAliquota.findMany({ orderBy: { uf: 'asc' } })
  console.log(`${todas.length} estados na tabela\n`)
  console.log('UF  interna  fcp  inter  método  fisco')
  for (const a of todas.filter((x) => ['CE', 'PI', 'SE', 'AL', 'SP', 'RN'].includes(x.uf))) {
    console.log(
      `${a.uf}  ${String(a.aliquotaInterna).padStart(6)}%  ${String(a.fcp).padStart(3)}  ` +
      `${String(a.interestadual).padStart(4)}%  ${a.metodo.padEnd(6)}  ${a.posicaoFisco ? 'sim' : 'não'}`
    )
  }
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e.message); await prisma.$disconnect() })
