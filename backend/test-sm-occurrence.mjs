/**
 * Busca pedidos São Miguel que têm ocorrência na API mas hasOccurrence=false no banco
 * railway run node backend/test-sm-occurrence.mjs
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

const orders = await prisma.order.findMany({
  where: { carrier: { trackingSystem: 'SAO_MIGUEL' }, status: { in: ['PENDING', 'IN_TRANSIT'] } },
  select: { orderNumber: true, nfNumber: true, senderCnpj: true, hasOccurrence: true, lastTracking: true },
  orderBy: { createdAt: 'desc' },
  take: 30,
})

for (const o of orders) {
  const cnpj = o.senderCnpj?.replace(/\D/g, '') ?? ''
  const nf = String(parseInt(o.nfNumber ?? '0', 10))
  const token = smCreateToken()

  const res = await fetch(SM_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Authorization': `Bearer ${token}`, 'Origin': 'https://portaldocliente.expressosaomiguel.com.br', 'Referer': 'https://portaldocliente.expressosaomiguel.com.br/' },
    body: JSON.stringify({ cpfcnpj: cnpj, numberdocument: nf, serie: '', documentType: 'NFE' }),
    signal: AbortSignal.timeout(15000),
  })

  const data = await res.json()
  if (!Array.isArray(data) || data.length === 0) continue

  const tracks = data[0].tracks ?? []
  // Mostra todos os eventos para ver quais palavras indicam ocorrência
  const eventTitles = tracks.map(t => t.title).filter(Boolean)
  if (eventTitles.some(t => /tentativa|ausente|endere|fechado|avaria|extravio|retido|recus|impedi|ocorr/i.test(t))) {
    console.log(`⚠️  ${o.orderNumber} | hasOccurrence=${o.hasOccurrence}`)
    eventTitles.forEach(t => console.log(`   "${t}"`))
  }
}

console.log('\nFim.')
await prisma.$disconnect()
