import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const total = await prisma.order.count({ where: { status: 'PENDING' } })
  const semTransp = await prisma.order.count({ where: { status: 'PENDING', carrierId: null } })
  const comTransp = await prisma.order.count({ where: { status: 'PENDING', carrierId: { not: null } } })
  const avic = await prisma.order.count({ where: { status: 'PENDING', orderNumber: { startsWith: 'AVIC-' } } })
  const agro = await prisma.order.count({ where: { status: 'PENDING', orderNumber: { startsWith: 'AGRO-' } } })
  const equi = await prisma.order.count({ where: { status: 'PENDING', orderNumber: { startsWith: 'EQUI-' } } })

  console.log('=== PEDIDOS PENDENTES ===')
  console.log('Total:', total)
  console.log('Sem transportadora:', semTransp)
  console.log('Com transportadora:', comTransp)
  console.log('AVIC:', avic, '| AGRO:', agro, '| EQUI:', equi)

  // Por transportadora
  const comTranspList = await prisma.order.findMany({
    where: { status: 'PENDING', carrierId: { not: null } },
    include: { carrier: { select: { name: true, id: true } } },
  })

  const contagem: Record<string, number> = {}
  for (const o of comTranspList) {
    const nome = o.carrier?.name ?? 'SEM NOME'
    contagem[nome] = (contagem[nome] ?? 0) + 1
  }

  console.log('\nPor transportadora (com PENDING):')
  Object.entries(contagem).sort((a, b) => b[1] - a[1]).forEach(([n, c]) => {
    console.log(' ', c, 'x', n)
  })

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
