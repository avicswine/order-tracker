import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import path from 'path'
import fs from 'fs'
import pino from 'pino'

export type WppCompany = 'avic' | 'agro'
type WppStatus = 'iniciando' | 'qr' | 'conectando' | 'pronto' | 'desconectado'

interface WppInstance {
  sock: WASocket | null
  status: WppStatus
  qrDataUrl: string | null
  numero: string | null
  reconnecting: boolean
}

const instances: Partial<Record<WppCompany, WppInstance>> = {}

function getAuthPath(company: WppCompany): string {
  const base = process.env.WPP_AUTH_PATH ?? path.join(process.cwd(), '.wpp_auth')
  return path.join(base, company)
}

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
  const jid = digits.endsWith('@s.whatsapp.net') ? digits : `${digits}@s.whatsapp.net`

  try {
    // Verifica se número existe no WhatsApp
    const results = await inst.sock.onWhatsApp(digits)
    const result = results?.[0]
    if (!result?.exists) {
      return { ok: false, error: 'Número não encontrado no WhatsApp' }
    }
    await inst.sock.sendMessage(jid, { text: message })
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

async function startInstance(company: WppCompany): Promise<void> {
  const authPath = getAuthPath(company)
  fs.mkdirSync(authPath, { recursive: true })

  const inst = instances[company]!
  inst.status = 'iniciando'
  inst.sock = null

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authPath)
    const { version } = await fetchLatestBaileysVersion()
    console.log(`[WhatsApp/${company}] Usando Baileys v${version.join('.')}`)

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      },
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['OrderTracker', 'Chrome', '120.0.0'],
    })

    inst.sock = sock

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        inst.status = 'qr'
        inst.qrDataUrl = await QRCode.toDataURL(qr)
        console.log(`[WhatsApp/${company}] QR gerado — escaneie para conectar`)
      }

      if (connection === 'connecting') {
        if (inst.status !== 'qr') inst.status = 'conectando'
        console.log(`[WhatsApp/${company}] Conectando…`)
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

        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode
        const loggedOut = reason === DisconnectReason.loggedOut

        console.log(`[WhatsApp/${company}] Desconectado — motivo: ${reason} ${loggedOut ? '(deslogado)' : '(reconectando)'}`)

        if (loggedOut) {
          // Limpa sessão e reinicia para mostrar novo QR
          clearAuth(company)
        }

        if (!inst.reconnecting) {
          inst.reconnecting = true
          setTimeout(async () => {
            inst.reconnecting = false
            await startInstance(company)
          }, 3000)
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

function clearAuth(company: WppCompany) {
  const authPath = getAuthPath(company)
  try { fs.rmSync(authPath, { recursive: true, force: true }) } catch { /* ignora */ }
  fs.mkdirSync(authPath, { recursive: true })
  console.log(`[WhatsApp/${company}] Sessão apagada — novo QR será gerado`)
}

function formatNumber(raw: string): string {
  const n = raw.replace(/\D/g, '')
  if (n.length === 13) return `+${n.slice(0,2)} (${n.slice(2,4)}) ${n.slice(4,9)}-${n.slice(9)}`
  if (n.length === 12) return `+${n.slice(0,2)} (${n.slice(2,4)}) ${n.slice(4,8)}-${n.slice(8)}`
  return `+${n}`
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
