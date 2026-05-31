/**
 * Backup/restore dos arquivos do Baileys (useMultiFileAuthState) no PostgreSQL.
 * Salva o conteúdo exato de cada arquivo como string — sem manipular dados binários.
 * Garante que a sessão sobrevive a restarts do Railway.
 */
import { prisma } from '../lib/prisma'
import fs from 'fs'
import path from 'path'

export async function restoreSessionFromDb(company: string, authDir: string): Promise<boolean> {
  try {
    const session = await prisma.whatsappSession.findUnique({ where: { company } })
    if (!session?.files) return false

    const files = JSON.parse(session.files) as Record<string, string>
    if (Object.keys(files).length === 0) return false

    fs.mkdirSync(authDir, { recursive: true })
    for (const [filename, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(authDir, filename), content, 'utf-8')
    }

    console.log(`[WhatsApp/${company}] Sessão restaurada do banco (${Object.keys(files).length} arquivos)`)
    return true
  } catch (err) {
    console.error(`[WhatsApp/${company}] Erro ao restaurar sessão:`, err instanceof Error ? err.message : err)
    return false
  }
}

export async function backupSessionToDb(company: string, authDir: string): Promise<void> {
  try {
    const filenames = fs.readdirSync(authDir).filter(f => f.endsWith('.json'))
    const files: Record<string, string> = {}
    for (const filename of filenames) {
      files[filename] = fs.readFileSync(path.join(authDir, filename), 'utf-8')
    }

    await prisma.whatsappSession.upsert({
      where: { company },
      update: { files: JSON.stringify(files) },
      create: { company, files: JSON.stringify(files) },
    })
  } catch (err) {
    console.error(`[WhatsApp/${company}] Erro ao salvar sessão:`, err instanceof Error ? err.message : err)
  }
}

export async function clearSessionFromDb(company: string): Promise<void> {
  try {
    await prisma.whatsappSession.deleteMany({ where: { company } })
  } catch { /* ignora */ }
}
