import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { sendMessage, type WppCompany } from './whatsapp'
import { sendEmail } from './emailer'

const PORTAL_URL = process.env.PORTAL_URL ?? 'https://order-tracker-production-4189.up.railway.app/portal/'

// Insere " - " entre o código do evento (CAIXA ALTA) e a descrição
// Ex: "SAIDA DE UNIDADESaida da unidade X" → "SAIDA DE UNIDADE - Saida da unidade X"
export function formatTrackingText(text: string): string {
  if (!text) return text
  return text
    .replace(/([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ]{3,})([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ(0-9])/, '$1 - $2')
    .replace(/\)\s+([A-Z][a-záéíóúàâêôãõç])/, ') - $1')
}

// Verifica se o evento é de entrega
function isDeliveryEvent(text: string): boolean {
  const t = text.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return t.includes('ENTREGUE') || t.includes('ENTREGA REALIZADA') || t.includes('ENTREGA EFETUADA') || t.includes('MERCADORIA ENTREGUE')
}

// CNPJ das empresas → instância WhatsApp
const SENDER_TO_WPP: Record<string, WppCompany> = {
  '47715256000149': 'avic',     // AVIC
  '54695386000122': 'agro',     // AGROGRANJA
  // Equipage não tem WhatsApp — vai por email
}

// Assinatura de email por empresa (logo + sites)
interface CompanySignature {
  logo: string
  sites: { label: string; url: string }[]
}

const COMPANY_SIGNATURE: Record<string, CompanySignature> = {
  '47715256000149': { // AVIC
    logo: 'https://cdn.awsli.com.br/2599/2599142/arquivos/logo-jpg.png',
    sites: [
      { label: 'avicventiladores.com.br', url: 'http://avicventiladores.com.br' },
      { label: 'avicswine.com.br', url: 'http://avicswine.com.br' },
    ],
  },
  '54695386000122': { // AGROGRANJA
    logo: 'https://cdn.awsli.com.br/2599/2599142/arquivos/logomarca.jpg',
    sites: [{ label: 'agrogranja.com.br', url: 'http://agrogranja.com.br' }],
  },
  '56633474000125': { // EQUIPAGE
    logo: 'https://cdn.awsli.com.br/2599/2599142/arquivos/logo-jpg.jpg',
    sites: [{ label: 'equipageimport.com.br', url: 'http://equipageimport.com.br' }],
  },
}

function buildSignature(senderCnpj: string | null): string {
  const sig = senderCnpj ? COMPANY_SIGNATURE[senderCnpj.replace(/\D/g, '')] : undefined
  if (!sig) return ''
  const sitesHtml = sig.sites
    .map(s => `<a href="${s.url}" style="color:#1d4ed8;text-decoration:none">${s.label}</a>`)
    .join(' &nbsp;|&nbsp; ')
  return `
  <table cellpadding="0" cellspacing="0" border="0" align="left" style="margin-top:28px;border-top:1px solid #e5e7eb;padding-top:16px;font-family:Arial,sans-serif;text-align:left">
    <tr>
      <td style="padding-right:16px;vertical-align:middle;text-align:left">
        <img src="${sig.logo}" alt="logo" style="max-height:67px;max-width:192px;display:block">
      </td>
      <td style="vertical-align:middle;border-left:2px solid #e5e7eb;padding-left:16px;text-align:left">
        <div style="font-weight:bold;color:#111;font-size:14px">Dionísio</div>
        <div style="color:#555;font-size:13px">Departamento de Logística</div>
        <div style="font-size:12px;margin-top:4px">${sitesHtml}</div>
      </td>
    </tr>
  </table>`
}

// Valida celular brasileiro: DDD (2 dígitos) + 9 + 8 dígitos = 11 dígitos
// Aceita também o formato antigo sem o 9 (10 dígitos), mas celulares SP/RJ sempre têm 9
function isMobilePhone(digits: string): boolean {
  if (!digits) return false
  const d = digits.replace(/\D/g, '')
  // Com código do país 55: 55 + 11 dígitos = 13; sem: 11 dígitos
  const local = d.startsWith('55') ? d.slice(2) : d
  if (local.length === 11) return local[2] === '9'   // DDD + 9XXXXXXXX
  if (local.length === 10) return true               // DDD + 8 dígitos (celular antigo)
  return false
}

// Garante o formato 55DDDNUMERO para o WhatsApp
function toWhatsAppNumber(digits: string): string {
  const d = digits.replace(/\D/g, '')
  if (d.startsWith('55')) return d
  return '55' + d
}

function hashEvent(orderId: string, eventText: string): string {
  return crypto.createHash('sha256').update(`${orderId}:${eventText}`).digest('hex').slice(0, 16)
}

function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR')
}

function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

// Verifica se já enviou alguma notificação para esse pedido HOJE
async function sentToday(orderId: string): Promise<boolean> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const count = await prisma.orderNotification.count({
    where: { orderId, success: true, sentAt: { gte: today } },
  })
  return count > 0
}

// Verifica se esse evento já foi notificado (deduplicação)
async function alreadyNotified(orderId: string, eventHash: string): Promise<boolean> {
  const existing = await prisma.orderNotification.findUnique({
    where: { orderId_eventHash: { orderId, eventHash } },
  })
  return !!existing
}

async function saveNotification(
  orderId: string,
  eventHash: string,
  channel: string,
  success: boolean,
  recipient?: string,
  eventText?: string,
  error?: string
) {
  try {
    await prisma.orderNotification.create({
      data: { orderId, eventHash, channel, success, recipient: recipient ?? null, eventText: eventText ?? null, error: error ?? null },
    })
  } catch {
    // @@unique pode dar conflito em paralelo — ignora
  }
}

function buildWhatsAppMessage(order: {
  orderNumber: string
  nfNumber: string | null
  customerName: string
  estimatedDelivery: Date | null
  lastTracking: string | null
}, isFirstToday: boolean, isFirstEver: boolean): string {
  const evento = formatTrackingText(order.lastTracking ?? '')
  const previsao = order.estimatedDelivery ? formatDate(order.estimatedDelivery) : null
  const delivered = isDeliveryEvent(evento)

  const rodape = `\nPara acompanhar o rastreio, basta acessar o link:\n${PORTAL_URL}\n\nE digitar o seu CPF ou CNPJ.\nAgradecemos a preferência. 🙏`

  if (delivered) {
    return `*ENTREGUE* ✅\nOlá, ${order.customerName.split(' ')[0]}! Que ótima notícia! 🎉\n\nSua encomenda chegou ao destino.\n\nEsperamos que tudo esteja conforme o pedido. Qualquer dúvida, estamos à disposição.\n\nAgradecemos a preferência! 🙏`
  }

  if (isFirstEver) {
    // Primeiro evento de rastreio = CT-e emitido = ENVIADO
    // Texto 100% nosso (não expõe o evento técnico cru da transportadora)
    let body = `*ENVIADO* 🚚\nOlá, ${order.customerName.split(' ')[0]}! Seu pedido foi despachado e já está a caminho. 📦`
    if (previsao) body += `\n\n📅 Previsão de entrega: ${previsao}.`
    body += rodape
    return body
  }

  if (isFirstToday) {
    return `Olá, tudo bem? Seu pedido teve uma atualização:\n${evento}${rodape}`
  }

  return `Oi, eu novamente, Seu pedido teve uma atualização:\n${evento}${rodape}`
}

function buildEmailHtml(order: {
  orderNumber: string
  nfNumber: string | null
  customerName: string
  senderCnpj: string | null
  estimatedDelivery: Date | null
  lastTracking: string | null
}, isFirstEver: boolean): string {
  const nf = order.nfNumber ? String(parseInt(order.nfNumber, 10)) : order.orderNumber
  const evento = formatTrackingText(order.lastTracking ?? '')
  const previsao = order.estimatedDelivery ? formatDate(order.estimatedDelivery) : null
  const delivered = isDeliveryEvent(evento)

  const titulo = delivered ? 'Encomenda entregue! ✅' : isFirstEver ? 'Pedido enviado 🚚' : 'Atualização do pedido'
  const borderColor = delivered ? '#16a34a' : '#1d4ed8'
  const primeiroNome = order.customerName.split(' ')[0]

  return `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <h2 style="color:${borderColor}">${titulo}</h2>
  <p>Olá, ${primeiroNome}${delivered ? '! Que ótima notícia! 🎉' : '!'}</p>
  ${delivered
    ? `<p>Sua encomenda chegou ao destino.</p>
  <p>Esperamos que tudo esteja conforme o pedido. Qualquer dúvida, estamos à disposição.</p>`
    : `<p>Seu pedido <strong>NF ${nf}</strong> foi despachado e já está a caminho. 📦</p>
  ${previsao && isFirstEver ? `<p>📅 <strong>Previsão de entrega:</strong> ${previsao}</p>` : ''}
  <p>Para acompanhar o rastreio:<br>
    <a href="${PORTAL_URL}" style="color:#1d4ed8">${PORTAL_URL}</a><br>
    Digite seu CPF ou CNPJ.
  </p>`}
  <p style="color:#64748b;font-size:13px">Agradecemos a preferência! 🙏</p>
  ${buildSignature(order.senderCnpj)}
</body>
</html>`
}

// ─── Helpers de envio ───────────────────────────────────────────────────────

async function dispatch(
  orderId: string,
  eventHash: string,
  subject: string,
  wppMessage: string,
  emailHtml: string,
  contact: { phone: string | null; email: string | null; senderCnpj: string | null },
  eventText?: string
): Promise<void> {
  const phone = contact.phone?.replace(/\D/g, '') ?? ''
  const wppCompany = contact.senderCnpj ? SENDER_TO_WPP[contact.senderCnpj.replace(/\D/g, '')] : undefined
  let notified = false

  if (phone && isMobilePhone(phone) && wppCompany) {
    const wppNumber = toWhatsAppNumber(phone)
    const result = await sendMessage(wppCompany, wppNumber, wppMessage)
    if (result.ok) {
      await saveNotification(orderId, eventHash, 'WHATSAPP', true, wppNumber, eventText)
      notified = true
    } else {
      await saveNotification(orderId, eventHash, 'WHATSAPP', false, wppNumber, eventText, result.error)
    }
  }

  if (!notified && contact.email) {
    const result = await sendEmail(contact.email, subject, emailHtml, contact.senderCnpj)
    if (result.ok) {
      await saveNotification(orderId, eventHash, 'EMAIL', true, contact.email, eventText)
    } else {
      await saveNotification(orderId, eventHash, 'EMAIL', false, contact.email, eventText, result.error)
    }
  }
}

// ─── FATURADO ───────────────────────────────────────────────────────────────

export async function notifyFaturado(order: {
  id: string
  orderNumber: string
  nfNumber: string | null
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  senderCnpj: string | null
  linkDanfe: string | null
  nfIssuedAt: Date | null
}): Promise<void> {
  const eventHash = hashEvent(order.id, 'FATURADO')
  if (await alreadyNotified(order.id, eventHash)) return

  const nf = order.nfNumber ? String(parseInt(order.nfNumber, 10)) : order.orderNumber
  const linkLine = order.linkDanfe ? `\n\n📄 Segue o link da sua Nota Fiscal:\n${order.linkDanfe}` : ''

  const primeiroNome = order.customerName.split(' ')[0]
  const wppMessage = `*FATURADO* 🧾\nOlá, ${primeiroNome}!\n\nSeu pedido NF ${nf} foi faturado.${linkLine}\n\nAgradecemos a preferência. 🙏`

  const emailHtml = `<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <h2 style="color:#7c3aed">Faturado 🧾</h2>
  <p>Olá, ${primeiroNome}!</p>
  <p>Seu pedido <strong>NF ${nf}</strong> foi faturado.</p>
  ${order.linkDanfe ? `<p>📄 <a href="${order.linkDanfe}" style="color:#7c3aed">Consulte sua Nota Fiscal aqui</a></p>` : ''}
  <p style="color:#64748b;font-size:13px">Agradecemos a preferência.</p>
  ${buildSignature(order.senderCnpj)}
</body>
</html>`

  await dispatch(order.id, eventHash, `Pedido faturado — NF ${nf}`, wppMessage, emailHtml,
    { phone: order.customerPhone, email: order.customerEmail, senderCnpj: order.senderCnpj },
    'FATURADO'
  )
  console.log(`[Notifier] 🧾 FATURADO → ${order.orderNumber}`)
}

export async function notifyOrderUpdate(order: {
  id: string
  orderNumber: string
  nfNumber: string | null
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  senderCnpj: string | null
  estimatedDelivery: Date | null
  lastTracking: string | null
  lastTrackingAt: Date | null
}): Promise<void> {
  if (!order.lastTracking) return

  const eventHash = hashEvent(order.id, order.lastTracking)
  if (await alreadyNotified(order.id, eventHash)) return

  const alreadySentToday = await sentToday(order.id)
  const anyPrior = await prisma.orderNotification.count({ where: { orderId: order.id, success: true } })
  const isFirstEver = anyPrior === 0

  // Pedido já entregue na primeira detecção → não notifica
  if (isFirstEver && isDeliveryEvent(order.lastTracking)) {
    console.log(`[Notifier] ℹ️ ${order.orderNumber}: já entregue na primeira detecção — ignorado`)
    return
  }

  // Só notifica ENVIADO (primeiro evento) e ENTREGUE — intermediários são ignorados
  const delivered = isDeliveryEvent(order.lastTracking)
  if (!isFirstEver && !delivered) {
    console.log(`[Notifier] ℹ️ ${order.orderNumber}: evento intermediário — ignorado`)
    return
  }

  const nf = order.nfNumber ? String(parseInt(order.nfNumber, 10)) : order.orderNumber
  const subject = delivered
    ? `Entregue ✅ — NF ${nf}`
    : isFirstEver
      ? `Enviado 🚚 — NF ${nf}`
      : `Atualização do pedido — NF ${nf}`

  const wppMessage = buildWhatsAppMessage(order, !alreadySentToday, isFirstEver)
  const emailHtml = buildEmailHtml(order, isFirstEver)

  await dispatch(order.id, eventHash, subject, wppMessage, emailHtml,
    { phone: order.customerPhone, email: order.customerEmail, senderCnpj: order.senderCnpj },
    order.lastTracking
  )

  const tag = delivered ? '✅ ENTREGUE' : isFirstEver ? '🚚 ENVIADO' : '📦 Atualização'
  console.log(`[Notifier] ${tag} → ${order.orderNumber}`)
}
