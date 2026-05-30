import { Resend } from 'resend'

let client: Resend | null = null

function getClient(): Resend {
  if (client) return client
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY não configurada')
  client = new Resend(apiKey)
  return client
}

const FROM = process.env.EMAIL_FROM ?? 'no-reply@avicswine.com.br'

export async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const resend = getClient()
    const { error } = await resend.emails.send({ from: `Rastreamento AVIC <${FROM}>`, to, subject, html })
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Email] Erro ao enviar:', msg)
    return { ok: false, error: msg }
  }
}
