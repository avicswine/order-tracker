/**
 * railway run node backend/test-dates.mjs
 */
import { PrismaClient } from '@prisma/client'
import { createCipheriv, createHash, randomBytes } from 'crypto'

const prisma = new PrismaClient()
const SM_APP_KEY = 'Sx8AHhuIpDZYfY5GlzOzrlG1fYlhl4HD'
const SM_API_URL = process.env.SM_PROXY_URL || 'https://srv.expressosaomiguel.com.br:40490/api-portal-cliente/tracks'

function smCreateToken() {
  const payload = JSON.stringify({ message: 'esm_decripter', expired_in: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
  const salt = randomBytes(8)
  let derived = Buffer.alloc(0), block = Buffer.alloc(0)
  while (derived.length < 48) {
    const h = createHash('md5'); h.update(block); h.update(Buffer.from(SM_APP_KEY, 'utf8')); h.update(salt)
    block = h.digest(); derived = Buffer.concat([derived, block])
  }
  const key = derived.subarray(0, 32), iv = derived.subarray(32, 48)
  const c = createCipheriv('aes-256-cbc', key, iv)
  const enc = Buffer.concat([c.update(payload, 'utf8'), c.final()])
  return Buffer.concat([Buffer.from('Salted__'), salt, enc]).toString('base64')
}

const order = await prisma.order.findFirst({
  where: { nfNumber: { in: ['3128', '003128'] }, senderCnpj: { contains: '54695386' } },
  select: { orderNumber: true, nfNumber: true, senderCnpj: true, shippedAt: true, estimatedDelivery: true, lastTracking: true, status: true, carrier: { select: { name: true, trackingSystem: true } } },
})

if (!order) { console.log('Pedido não encontrado'); process.exit(0) }

console.log('=== BANCO ===')
console.log('Pedido:', order.orderNumber)
console.log('Status:', order.status)
console.log('Carrier:', order.carrier?.name, '|', order.carrier?.trackingSystem)
console.log('shippedAt (enviado):', order.shippedAt?.toLocaleDateString('pt-BR') ?? 'null')
console.log('estimatedDelivery (previsão):', order.estimatedDelivery?.toLocaleDateString('pt-BR') ?? 'null')
console.log('lastTracking:', order.lastTracking)

console.log('\n=== API SÃO MIGUEL ===')
const cnpj = order.senderCnpj?.replace(/\D/g, '') ?? ''
const nf = String(parseInt(order.nfNumber ?? '0', 10))
const token = smCreateToken()

const res = await fetch(SM_API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Authorization': `Bearer ${token}`, 'Origin': 'https://portaldocliente.expressosaomiguel.com.br', 'Referer': 'https://portaldocliente.expressosaomiguel.com.br/' },
  body: JSON.stringify({ cpfcnpj: cnpj, numberdocument: nf, serie: '', documentType: 'NFE' }),
  signal: AbortSignal.timeout(15000),
})

const data = await res.json()
if (!Array.isArray(data) || data.length === 0) { console.log('API: sem dados'); process.exit(0) }

const cte = data[0]
console.log('embark (campo "enviado" na SM):', cte.embark)
console.log('expectedDate (previsão):', cte.expectedDate)
console.log('Eventos (tracks):')
;(cte.tracks ?? []).forEach(t => console.log(`  [${t.control}] ${t.date} ${t.hour ?? ''} — ${t.title}`))

await prisma.$disconnect()
