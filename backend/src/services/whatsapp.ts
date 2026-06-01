import QRCode from 'qrcode'
import path from 'path'
import fs from 'fs'
import { restoreSessionFromDb, backupSessionToDb, clearSessionFromDb } from './whatsappSession'

export type WppCompany = 'avic' | 'agro'
type WppStatus = 'iniciando' | 'qr' | 'conectando' | 'pronto' | 'desconectado'

// Importação dinâmica real (bypassa o require() do CommonJS)
// Necessário porque @whiskeysockets/baileys é ESM-only
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importBaileys = () => new Function('return import("@whiskeysockets/baileys")')() as Promise<typeof import('@whiskeysockets/baileys')>

interface WppInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sock: any
  status: WppStatus
  qrDataUrl: string | null
  numero: string | null
  reconnecting: boolean
  reconnectAttempts: number
}

const instances: Partial<Record<WppCompany, WppInstance>> = {}


export function getStatus(company: WppCompany): { status: WppStatus; qr: string | null; numero: string | null } {
  const inst = instances[company]
  if (!inst) return { status: 'desconectado', qr: null, numero: null }
  return { status: inst.status, qr: inst.qrDataUrl, numero: inst.numero }
}

export async function sendMessage(company: WppCompany, phone: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const inst = instances[company]
  if (!inst?.sock || inst.status !== 'pronto') {
    return { ok: false, error: `WhatsApp ${company} não está conectado (status: ${inst?.status ?? 'não iniciado'})` }
  }

  // Gera os dois formatos possíveis: com e sem o dígito 9 extra (migração BR)
  const candidates = normalizeBrPhone(phone)

  try {
    // Tenta cada formato até achar um que existe no WhatsApp
    for (const candidate of candidates) {
      const results = await inst.sock.onWhatsApp(candidate)
      const result = Array.isArray(results) ? results[0] : null
      if (result?.exists) {
        const jid = result.jid ?? `${candidate}@s.whatsapp.net`
        await inst.sock.sendMessage(jid, { text: message })
        return { ok: true }
      }
    }
    return { ok: false, error: 'Número não encontrado no WhatsApp' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

/**
 * Gera os dois formatos brasileiros de um número de celular:
 * novo (com 9) e antigo (sem 9), ambos com código de país 55.
 *
 * Exemplos:
 *   "554991885757"  → ["554991885757",  "5549991885757"]  (antigo → tenta novo também)
 *   "5549991885757" → ["5549991885757", "554991885757"]   (novo → tenta antigo também)
 *   "49991885757"   → ["5549991885757", "554991885757"]
 *   "4991885757"    → ["554991885757",  "5549991885757"]
 */
function normalizeBrPhone(raw: string): string[] {
  const d = raw.replace(/\D/g, '')

  // Remove código de país se presente
  let local = d.startsWith('55') && d.length > 11 ? d.slice(2) : d

  // Precisa de pelo menos DDD (2) + número (8 ou 9)
  if (local.length < 10 || local.length > 11) return [`55${local}`]

  const ddd = local.slice(0, 2)
  const num = local.slice(2) // 8 ou 9 dígitos

  if (num.length === 8) {
    // Formato antigo: adiciona 9 para gerar o novo
    return [`55${ddd}${num}`, `55${ddd}9${num}`]
  } else {
    // num.length === 9 — formato novo (começa com 9): remove para gerar o antigo
    return [`55${ddd}${num}`, `55${ddd}${num.slice(1)}`]
  }
}

function clearAuth(company: WppCompany) {
  const p = getAuthPath(company)
  try { fs.rmSync(p, { recursive: true, force: true }) } catch { /* ignora */ }
  fs.mkdirSync(p, { recursive: true })
  clearSessionFromDb(company).catch(() => { /* ignora */ })
  console.log(`[WhatsApp/${company}] Sessão apagada — novo QR será gerado`)
}

function formatNumber(raw: string): string {
  const n = raw.replace(/\D/g, '')
  if (n.length === 13) return `+${n.slice(0,2)} (${n.slice(2,4)}) ${n.slice(4,9)}-${n.slice(9)}`
  if (n.length === 12) return `+${n.slice(0,2)} (${n.slice(2,4)}) ${n.slice(4,8)}-${n.slice(8)}`
  return `+${n}`
}

function getAuthPath(company: WppCompany): string {
  // /tmp sobrevive dentro da mesma instância Railway mas é perdido em restarts
  const base = process.env.WPP_AUTH_PATH ?? '/tmp/.wpp_auth'
  const p = path.join(base, company)
  fs.mkdirSync(p, { recursive: true })
  return p
}

async function startInstance(company: WppCompany): Promise<void> {
  const inst = instances[company]!
  inst.status = 'iniciando'
  inst.sock = null

  try {
    const authDir = getAuthPath(company)

    // Tenta restaurar sessão do banco antes de inicializar
    await restoreSessionFromDb(company, authDir)

    const baileys = await importBaileys()
    const { useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, DisconnectReason } = baileys
    const makeWASocket = baileys.default

    const { state, saveCreds: baileySaveCreds } = await useMultiFileAuthState(authDir)

    // Envolve saveCreds para também fazer backup no banco
    const saveCreds = async () => {
      await baileySaveCreds()
      await backupSessionToDb(company, authDir)
    }

    // Versão fixa evita chamada HTTP ao GitHub em cada reconexão
    // (fetchLatestBaileysVersion pode falhar/rate-limit e causar drop)
    let version: [number, number, number] = [2, 3000, 1015901307]
    try {
      const fetched = await fetchLatestBaileysVersion()
      version = fetched.version
    } catch {
      console.warn(`[WhatsApp/${company}] fetchLatestBaileysVersion falhou — usando versão fallback`)
    }
    console.log(`[WhatsApp/${company}] Baileys v${version.join('.')} — conectando...`)

    // pino silent para não poluir os logs
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pino = require('pino')
    const logger = pino({ level: 'silent' })

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: ['Ubuntu', 'Chrome', '120.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      keepAliveIntervalMs: 30_000,
      connectTimeoutMs: 60_000,
      // Evita drops por pedidos de retry de mensagens sem store
      getMessage: async () => undefined,
    })

    inst.sock = sock

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update: { connection?: string; lastDisconnect?: { error?: unknown }; qr?: string }) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        inst.status = 'qr'
        inst.qrDataUrl = await QRCode.toDataURL(qr)
        console.log(`[WhatsApp/${company}] QR gerado — escaneie para conectar`)
      }

      if (connection === 'connecting' && inst.status !== 'qr') {
        inst.status = 'conectando'
      }

      if (connection === 'open') {
        inst.status = 'pronto'
        inst.qrDataUrl = null
        inst.reconnectAttempts = 0
        const num = sock.user?.id?.split(':')[0] ?? null
        inst.numero = num ? formatNumber(num) : null
        console.log(`[WhatsApp/${company}] ✅ Conectado — ${inst.numero ?? 'número desconhecido'}`)
      }

      if (connection === 'close') {
        inst.status = 'desconectado'
        inst.qrDataUrl = null
        inst.numero = null

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Boom } = require('@hapi/boom')
        const statusCode = (lastDisconnect?.error instanceof Boom) ? (lastDisconnect.error as InstanceType<typeof Boom>).output.statusCode : 0
        const loggedOut = statusCode === DisconnectReason.loggedOut

        console.log(`[WhatsApp/${company}] Desconectado (${statusCode}) ${loggedOut ? '— sessão encerrada' : '— reconectando...'}`)

        if (loggedOut) clearAuth(company)

        if (!inst.reconnecting) {
          inst.reconnecting = true
          if (!loggedOut) inst.reconnectAttempts++
          // Backoff exponencial: 5s, 10s, 20s, 40s... máx 120s
          const delay = loggedOut ? 1000 : Math.min(5000 * Math.pow(2, inst.reconnectAttempts - 1), 120_000)
          console.log(`[WhatsApp/${company}] Reconectando em ${delay / 1000}s (tentativa ${inst.reconnectAttempts})`)
          setTimeout(async () => {
            inst.reconnecting = false
            await startInstance(company)
          }, delay)
        }
      }
    })
  } catch (err) {
    console.error(`[WhatsApp/${company}] Erro ao iniciar:`, err instanceof Error ? err.message : err)
    inst.status = 'desconectado'
    if (!inst.reconnecting) {
      inst.reconnecting = true
      inst.reconnectAttempts++
      const delay = Math.min(5000 * Math.pow(2, inst.reconnectAttempts - 1), 120_000)
      setTimeout(async () => {
        inst.reconnecting = false
        await startInstance(company)
      }, delay)
    }
  }
}

export function initWhatsApp() {
  console.log('[WhatsApp] Iniciando instâncias AVIC e AGRO (Baileys)...')
  for (const company of ['avic', 'agro'] as WppCompany[]) {
    instances[company] = { sock: null, status: 'iniciando', qrDataUrl: null, numero: null, reconnecting: false, reconnectAttempts: 0 }
    startInstance(company).catch(err =>
      console.error(`[WhatsApp/${company}] Falha ao iniciar:`, err?.message)
    )
  }
}

export async function restartInstance(company: WppCompany) {
  const inst = instances[company]
  if (inst?.sock) {
    try { await inst.sock.end(undefined) } catch { /* ignora */ }
  }
  if (inst) inst.reconnecting = false
  await startInstance(company)
}

export async function logoutInstance(company: WppCompany) {
  const inst = instances[company]
  if (inst?.sock) {
    try { await inst.sock.logout() } catch { /* ignora */ }
    try { await inst.sock.end(undefined) } catch { /* ignora */ }
  }
  clearAuth(company)
  if (inst) inst.reconnecting = false
  await startInstance(company)
}

export async function destroyAll() {
  for (const company of Object.keys(instances) as WppCompany[]) {
    const inst = instances[company]
    if (inst?.sock) {
      try { await inst.sock.end(undefined) } catch { /* ignora */ }
    }
  }
}
