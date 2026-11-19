import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const comCnpj = await prisma.order.count({ where: { recipientCnpj: { not: null } } })
  const semCnpj = await prisma.order.count({ where: { recipientCnpj: null } })
  console.log(`Com recipientCnpj: ${comCnpj} | Sem: ${semCnpj}`)
  await prisma.$disconnect()
}
main().catch(console.error)
