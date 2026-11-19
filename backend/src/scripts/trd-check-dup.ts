import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  // Busca qualquer carrier com CNPJ da família TRD (03350624)
  const all = await prisma.carrier.findMany({
    where: { OR: [{ cnpj: { contains: '03350624' } }, { cnpj: { contains: '03.350.624' } }, { name: { contains: 'DALFAN' } }] },
  })
  console.log('Carriers com CNPJ TRD/DALFAN:')
  all.forEach(c => console.log(`  ${c.name} | CNPJ: ${c.cnpj} | sistema: ${c.trackingSystem}`))

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
