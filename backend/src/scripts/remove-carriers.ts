import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const TERMOS_BLOQUEADOS = ['GARBERG', 'TNT', 'HS MOVERE']

async function main() {
  for (const termo of TERMOS_BLOQUEADOS) {
    const carrier = await prisma.carrier.findFirst({ where: { name: { contains: termo } } })
    if (!carrier) { console.log(`${termo}: não encontrada`); continue }

    const pedidosApagados = await prisma.order.deleteMany({ where: { carrierId: carrier.id } })
    const carrierApagada = await prisma.carrier.delete({ where: { id: carrier.id } })

    console.log(`${carrier.name}: ${pedidosApagados.count} pedidos apagados + transportadora removida`)
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
