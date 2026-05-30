import { Client, LocalAuth } from 'whatsapp-web.js'
import QRCode from 'qrcode'
import path from 'path'
import fs from 'fs'

export type WppCompany = 'avic' | 'agro'
type WppStatus = 'iniciando' | 'qr' | 'conectando' | 'pronto' | 'desconectado'

interface WppInstance {
  client: Client
  status: WppStatus
  qrDataUrl: string | null
  conectandoTimer: ReturnType<typeof setTimeout> | null
  tentativas: number
}

const instances: Partial<Record<WppCompany, WppInstance>> = {}

function getAuthPath(company: WppCompany): string {
  // Railway: /tmp é efêmero mas funciona entre requests da mesma instância
  const base = process.env.WPP_AUTH_PATH ?? path.join(process.cwd(), '.wwebjs_auth')
  return path.join(base, company)
}

function limparSessao(company: WppCompany) {
  const authDir = getAuthPath(company)
  try { fs.rmSync(authDir, { recursive: true, force: true }) } catch { /* ignora */ }
  console.log(`[WhatsApp/${company}] Sessão apagada — novo QR será gerado`)
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

export function getStatus(company: WppCompany): { status: WppStatus; qr: string | null; numero: string | null } {
  const inst = instances[company]
  if (!inst) return { status: 'desconectado', qr: null, numero: null }

  let numero: string | null = null
  if (inst.status === 'pronto') {
    try {
      const user = (inst.client as unknown as { info?: { wid?: { user?: string } } }).info?.wid?.user
      if (user) {
        const n = String(user)
        if (n.length >= 12) {
          numero = `+${n.slice(0,2)} (${n.slice(2,4)}) ${n.slice(4,n.length-4)}-${n.slice(-4)}`
        } else {
          numero = `+${n}`
        }
      }
    } catch { /* info ainda não disponível */ }
  }
  return { status: inst.status, qr: inst.qrDataUrl, numero }
}

export async function sendMessage(company: WppCompany, phone: string, message: string): Promise<{ ok: boolean; error?: string }> {
  const inst = instances[company]
  if (!inst || inst.status !== 'pronto') {
    return { ok: false, error: `WhatsApp ${company} não está conectado (status: ${inst?.status ?? 'não iniciado'})` }
  }

  const phoneDigits = phone.replace(/\D/g, '')
  try {
    const numberId = await inst.client.getNumberId(phoneDigits)
    if (!numberId) {
      return { ok: false, error: 'Número não encontrado no WhatsApp' }
    }
    await inst.client.sendMessage(numberId._serialized, message)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

function createInstance(company: WppCompany): WppInstance {
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: getAuthPath(company), clientId: company }),
    puppeteer: {
      headless: true,
      executablePath: execPath,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
  })

  const inst: WppInstance = { client, status: 'iniciando', qrDataUrl: null, conectandoTimer: null, tentativas: 0 }

  function limparTimer() {
    if (inst.conectandoTimer) { clearTimeout(inst.conectandoTimer); inst.conectandoTimer = null }
  }

  async function iniciar() {
    inst.status = 'iniciando'
    client.initialize().catch((err: Error) =>
      console.error(`[WhatsApp/${company}] Erro ao iniciar:`, err.message)
    )
  }

  client.on('qr', async (qr: string) => {
    limparTimer()
    inst.status = 'qr'
    inst.qrDataUrl = await QRCode.toDataURL(qr)
    console.log(`[WhatsApp/${company}] QR gerado — escaneie para conectar`)
  })

  client.on('loading_screen', (percent: number, message: string) => {
    inst.status = 'conectando'
    inst.qrDataUrl = null
    console.log(`[WhatsApp/${company}] Carregando ${percent}% — ${message}`)
    limparTimer()
    inst.conectandoTimer = setTimeout(async () => {
      if (inst.status !== 'pronto') {
        inst.tentativas++
        if (inst.tentativas >= 2) {
          console.warn(`[WhatsApp/${company}] ${inst.tentativas}ª tentativa falhou — limpando sessão...`)
          try { await client.destroy() } catch { /* ignora */ }
          limparSessao(company)
          inst.tentativas = 0
        } else {
          console.warn(`[WhatsApp/${company}] Preso em "conectando" — reiniciando...`)
          try { await client.destroy() } catch { /* ignora */ }
        }
        await sleep(2000)
        iniciar()
      }
    }, 60_000)
  })

  client.on('authenticated', () => {
    inst.status = 'conectando'
    inst.qrDataUrl = null
    console.log(`[WhatsApp/${company}] Autenticado`)
  })

  client.on('auth_failure', (msg: string) => {
    inst.status = 'desconectado'
    console.error(`[WhatsApp/${company}] Falha de autenticação:`, msg)
  })

  client.on('ready', () => {
    limparTimer()
    inst.tentativas = 0
    inst.status = 'pronto'
    inst.qrDataUrl = null
    console.log(`[WhatsApp/${company}] ✅ Pronto para enviar mensagens`)
  })

  client.on('disconnected', (reason: string) => {
    limparTimer()
    inst.status = 'desconectado'
    inst.qrDataUrl = null
    console.log(`[WhatsApp/${company}] Desconectado:`, reason)
  })

  iniciar()
  return inst
}

export function initWhatsApp() {
  console.log('[WhatsApp] Iniciando instâncias AVIC e AGRO...')
  instances.avic = createInstance('avic')
  instances.agro = createInstance('agro')
}

export async function restartInstance(company: WppCompany) {
  const inst = instances[company]
  if (!inst) return
  try { await inst.client.destroy() } catch { /* ignora */ }
  const newInst = createInstance(company)
  instances[company] = newInst
}

export async function logoutInstance(company: WppCompany) {
  const inst = instances[company]
  if (!inst) return
  try { await inst.client.logout() } catch { /* ignora */ }
  try { await inst.client.destroy() } catch { /* ignora */ }
  limparSessao(company)
  const newInst = createInstance(company)
  instances[company] = newInst
}

export async function destroyAll() {
  for (const company of Object.keys(instances) as WppCompany[]) {
    try { await instances[company]?.client.destroy() } catch { /* ignora */ }
  }
}
