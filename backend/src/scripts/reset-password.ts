import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'

const [, , email, password] = process.argv

if (!email || !password) {
  console.error('Uso: npx tsx src/scripts/reset-password.ts "email@exemplo.com" "nova-senha"')
  process.exit(1)
}

async function main() {
  const hashed = await bcrypt.hash(password, 12)
  const user = await prisma.user.update({
    where: { email },
    data: { password: hashed },
    select: { id: true, name: true, email: true, role: true },
  })
  console.log('Senha atualizada:')
  console.log(user)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
