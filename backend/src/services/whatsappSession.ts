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
    // Se o disco local JÁ tem creds (pareamento/sessão em andamento), NÃO restaura do banco.
    // Isso evita sobrescrever a sessão nova após o evento 515 (restart required pós-scan).
    if (fs.existsSync(path.join(authDir, 'creds.json'))) {
      console.log(`[WhatsApp/${company}] Sessão local presente — não restaura do banco`)
      return false
    }

    const session = await prisma.whatsappSession.findUnique({ where: { company } })
    if (!session?.files) return false

    const files = JSON.parse(session.files) as Record<string, string>
    // Sessão de 1 arquivo (só creds, sem keys) é incompleta → ignora para não gerar loop 401
    if (Object.keys(files).length <= 1) {
      console.log(`[WhatsApp/${company}] Sessão no banco incompleta (${Object.keys(files).length} arquivo) — ignorada`)
      await prisma.whatsappSession.deleteMany({ where: { company } })
      return false
    }

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
    // Não salva sessão incompleta (só creds, sem keys) — evita lixo que causa loop 401
    if (filenames.length <= 1) return

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
