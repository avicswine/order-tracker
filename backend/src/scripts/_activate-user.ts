import { prisma } from '../lib/prisma'

async function main() {
  const user = await prisma.user.update({
    where: { email: 'admin@avicswine.com.br' },
    data: { active: true },
    select: { id: true, name: true, email: true, role: true, active: true },
  })
  console.log('Usuário ativado:', user)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
