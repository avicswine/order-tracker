/**
 * Define uma senha de acesso para o banco LOCAL de desenvolvimento.
 * A senha é gerada aqui e gravada em backend/.env.acesso-local (ignorado pelo git).
 * Não vale para produção: lá os usuários e senhas são outros.
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { writeFileSync } from 'fs'
import path from 'path'

const prisma = new PrismaClient()
const EMAIL = 'jose@email.com'

async function main() {
  const db = process.env.DATABASE_URL ?? ''
  if (!/localhost|127\.0\.0\.1/.test(db)) {
    console.error('ABORTADO: o DATABASE_URL não aponta para localhost.')
    process.exit(1)
  }

  const senha = randomBytes(9).toString('base64url')
  const hash = await bcrypt.hash(senha, 12)
  await prisma.user.update({
    where: { email: EMAIL },
    data: { password: hash, active: true },
  })

  const destino = path.join(process.cwd(), '.env.acesso-local')
  writeFileSync(
    destino,
    `# Acesso ao order-tracker rodando NA SUA MÁQUINA (banco local).\n` +
      `# Não vale para o Railway. Arquivo ignorado pelo git.\n` +
      `# Gerado em ${new Date().toLocaleString('pt-BR')}\n\n` +
      `USUARIO=${EMAIL}\n` +
      `SENHA=${senha}\n`,
    'utf-8'
  )
  console.log(`senha definida para ${EMAIL} no banco local`)
  console.log(`gravada em: ${destino}`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error('falhou:', e.message)
  await prisma.$disconnect()
  process.exit(1)
})
