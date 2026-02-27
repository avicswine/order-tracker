import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { UserRole } from '@prisma/client'

const [, , name, email, password, role] = process.argv

if (!name || !email || !password) {
  console.error('Uso: npx tsx src/scripts/create-user.ts "Nome" "email@exemplo.com" "senha123" [ADMIN|VIEWER]')
  process.exit(1)
}

const userRole = role === 'ADMIN' ? UserRole.ADMIN : UserRole.VIEWER

async function main() {
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.error(`Usuário com email "${email}" já existe.`)
    process.exit(1)
  }

  const hashed = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: { name, email, password: hashed, role: userRole },
    select: { id: true, name: true, email: true, role: true },
  })

  console.log('Usuário criado com sucesso:')
  console.log(user)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
