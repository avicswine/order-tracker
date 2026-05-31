import { Resend } from 'resend'

let client: Resend | null = null

function getClient(): Resend {
  if (client) return client
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY não configurada')
  client = new Resend(apiKey)
  return client
}

// Remetente por empresa (CNPJ só dígitos → { from, nome })
const SENDERS: Record<string, { email: string; nome: string }> = {
  '47715256000149': { email: 'no-reply@avicswine.com.br', nome: 'Rastreamento Avic' },
  '54695386000122': { email: 'no-reply@agrogranja.com.br', nome: 'Rastreamento Agrogranja' },
}

const DEFAULT_SENDER = { email: process.env.EMAIL_FROM ?? 'no-reply@avicswine.com.br', nome: 'Rastreamento' }

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  senderCnpj?: string | null
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resend = getClient()
    const sender = (senderCnpj && SENDERS[senderCnpj.replace(/\D/g, '')]) || DEFAULT_SENDER
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
    console.error('[Email] Erro ao enviar:', msg)
    return { ok: false, error: msg }
  }
}
