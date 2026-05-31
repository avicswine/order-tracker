import { Resend } from 'resend'

// Configuração de remetente por empresa (CNPJ só dígitos)
// Cada empresa tem sua própria conta/API key no Resend
interface SenderConfig {
  apiKeyEnv: string
  email: string
  nome: string
}

const SENDERS: Record<string, SenderConfig> = {
  '47715256000149': { apiKeyEnv: 'RESEND_API_KEY',      email: 'no-reply@avicswine.com.br',  nome: 'Rastreamento Avic' },
  '54695386000122': { apiKeyEnv: 'RESEND_API_KEY_AGRO', email: 'no-reply@agrogranja.com.br', nome: 'Rastreamento Agrogranja' },
}

// Fallback: usa a conta da AVIC
const DEFAULT_SENDER: SenderConfig = { apiKeyEnv: 'RESEND_API_KEY', email: process.env.EMAIL_FROM ?? 'no-reply@avicswine.com.br', nome: 'Rastreamento' }

// Cache de clients por API key (evita recriar a cada envio)
const clients: Record<string, Resend> = {}

function getClient(apiKeyEnv: string): Resend {
  const apiKey = process.env[apiKeyEnv]
  if (!apiKey) throw new Error(`${apiKeyEnv} não configurada`)
  if (!clients[apiKey]) clients[apiKey] = new Resend(apiKey)
  return clients[apiKey]
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  senderCnpj?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const sender = (senderCnpj && SENDERS[senderCnpj.replace(/\D/g, '')]) || DEFAULT_SENDER
  try {
    const resend = getClient(sender.apiKeyEnv)
    const { error } = await resend.emails.send({
      from: `${sender.nome} <${sender.email}>`,
      to,
      subject,
      html,
    })
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[Email] Erro ao enviar (${sender.email}):`, msg)
    return { ok: false, error: msg }
  }
}
