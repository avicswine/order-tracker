import QRCode from 'qrcode'
import { useDBAuthState, clearDBAuthState } from './whatsappAuth'

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

  const digits = phone.replace(/\D/g, '')

  try {
    const results = await inst.sock.onWhatsApp(digits)
    const result = Array.isArray(results) ? results[0] : null
    if (!result?.exists) {
      return { ok: false, error: 'Número não encontrado no WhatsApp' }
    }
    // Usa o JID retornado pelo onWhatsApp (mais confiável que construir manualmente)
    const jid = result.jid ?? `${digits}@s.whatsapp.net`
    console.log(`[WhatsApp] Enviando para JID: ${jid}`)
    await inst.sock.sendMessage(jid, { text: message })
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

async function clearAuth(company: WppCompany) {
  await clearDBAuthState(company)
  console.log(`[WhatsApp/${company}] Sessão apagada do banco — novo QR será gerado`)
}

function formatNumber(raw: string): string {
  const n = raw.replace(/\D/g, '')
  if (n.length === 13) return `+${n.slice(0,2)} (${n.slice(2,4)}) ${n.slice(4,9)}-${n.slice(9)}`
  if (n.length === 12) return `+${n.slice(0,2)} (${n.slice(2,4)}) ${n.slice(4,8)}-${n.slice(8)}`
  return `+${n}`
}

async function startInstance(company: WppCompany): Promise<void> {
  const inst = instances[company]!
  inst.status = 'iniciando'
  inst.sock = null

  try {
    const baileys = await importBaileys()
    const { fetchLatestBaileysVersion, makeCacheableSignalKeyStore, DisconnectReason } = baileys
    const makeWASocket = baileys.default

    const { state, saveCreds } = await useDBAuthState(company)
    const { version } = await fetchLatestBaileysVersion()
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
      browser: ['OrderTracker', 'Chrome', '120.0.0'],
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

        if (loggedOut) await clearAuth(company)

        if (!inst.reconnecting) {
          inst.reconnecting = true
          setTimeout(async () => {
            inst.reconnecting = false
            await startInstance(company)
          }, loggedOut ? 1000 : 5000)
        }
      }
    })
  } catch (err) {
    console.error(`[WhatsApp/${company}] Erro ao iniciar:`, err instanceof Error ? err.message : err)
    inst.status = 'desconectado'
    if (!inst.reconnecting) {
      inst.reconnecting = true
      setTimeout(async () => {
        inst.reconnecting = false
        await startInstance(company)
      }, 10_000)
    }
  }
}

export function initWhatsApp() {
  console.log('[WhatsApp] Iniciando instâncias AVIC e AGRO (Baileys)...')
  for (const company of ['avic', 'agro'] as WppCompany[]) {
    instances[company] = { sock: null, status: 'iniciando', qrDataUrl: null, numero: null, reconnecting: false }
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
  await clearAuth(company)
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
