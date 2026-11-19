import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const us = await prisma.user.findMany({ select: { email: true, name: true, role: true, active: true } })
  console.log(`${us.length} usuário(s) no banco local`)
  us.forEach((u) => console.log(`   ${u.email} · ${u.name} · ${u.role} · ${u.active ? 'ativo' : 'inativo'}`))
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e.message); await prisma.$disconnect() })
