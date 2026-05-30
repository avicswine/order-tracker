/**
 * Auth state do Baileys persistido no PostgreSQL.
 * Substitui useMultiFileAuthState para sobreviver a restarts do Railway.
 */
import { prisma } from '../lib/prisma'

type WppCompany = 'avic' | 'agro'

// Importação dinâmica do Baileys (ESM em backend CJS)
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importBaileys = () => new Function('return import("@whiskeysockets/baileys")')() as Promise<typeof import('@whiskeysockets/baileys')>

export async function useDBAuthState(company: WppCompany) {
  const { initAuthCreds, BufferJSON } = await importBaileys()

  // Carrega do banco ou inicializa do zero
  const row = await prisma.whatsappSession.findUnique({ where: { company } })

  let creds = row?.creds
    ? JSON.parse(JSON.stringify(row.creds), BufferJSON.reviver)
    : initAuthCreds()

  let keys: Record<string, Record<string, unknown>> = row?.keys
    ? JSON.parse(JSON.stringify(row.keys), BufferJSON.reviver)
    : {}

  async function saveToDB() {
    const data = {
      creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
      keys: JSON.parse(JSON.stringify(keys, BufferJSON.replacer)),
    }
    await prisma.whatsappSession.upsert({
      where: { company },
      update: { creds: data.creds, keys: data.keys },
      create: { company, creds: data.creds, keys: data.keys },
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const keyStore: any = {
    get: async (type: string, ids: string[]) => {
      const keyMap = (keys[type] ?? {}) as Record<string, unknown>
      const result: Record<string, unknown> = {}
      for (const id of ids) result[id] = keyMap[id]
      return result
    },
    set: async (data: Record<string, Record<string, unknown> | null | undefined>) => {
      for (const [type, entries] of Object.entries(data)) {
        if (!entries) continue
        keys[type] = keys[type] ?? {}
        for (const [id, val] of Object.entries(entries)) {
          if (val == null) delete keys[type][id]
          else keys[type][id] = val
        }
      }
      await saveToDB()
    },
  }

  const state = { creds, keys: keyStore }

  const saveCreds = async () => {
    // creds pode ter sido mutado pelo Baileys — salvar versão atual
    await saveToDB()
  }

  return { state, saveCreds }
}

export async function clearDBAuthState(company: WppCompany) {
  await prisma.whatsappSession.deleteMany({ where: { company } })
}
