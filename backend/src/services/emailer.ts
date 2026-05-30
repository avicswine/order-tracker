import nodemailer from 'nodemailer'

let transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter

  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD

  if (!user || !pass) {
    throw new Error('GMAIL_USER e GMAIL_APP_PASSWORD não configurados')
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })

  return transporter
}

export async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const t = getTransporter()
    const from = process.env.GMAIL_USER!
    await t.sendMail({ from: `"Rastreamento" <${from}>`, to, subject, html })
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[Email] Erro ao enviar:', msg)
    return { ok: false, error: msg }
  }
}
