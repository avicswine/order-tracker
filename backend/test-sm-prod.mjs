/**
 * Diagnóstico São Miguel — produção
 * Rodar: railway run node backend/test-sm-prod.mjs
 */
import { PrismaClient } from '@prisma/client'
import { createCipheriv, createHash, randomBytes } from 'crypto'

const prisma = new PrismaClient()
const SM_APP_KEY = 'Sx8AHhuIpDZYfY5GlzOzrlG1fYlhl4HD'
const PROXY_URL = process.env.SM_PROXY_URL || 'https://srv.expressosaomiguel.com.br:40490/api-portal-cliente/tracks'

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

async function testNF(cnpj, nf) {
  const token = smCreateToken()
  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ cpfcnpj: cnpj.replace(/\D/g, ''), numberdocument: String(parseInt(nf, 10)), serie: '', documentType: 'NFE' }),
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    const data = JSON.parse(text)
    if (Array.isArray(data) && data.length > 0) {
      const track = data[0].tracks?.[0]
      return `✓ ${track?.title ?? 'sem evento'} (embark: ${data[0].embark ?? '-'})`
    }
    return `[] vazio`
  } catch (e) {
    return `ERRO: ${e.message}`
  }
}

console.log('SM_PROXY_URL:', PROXY_URL)
console.log('')

const orders = await prisma.order.findMany({
  where: {
    carrier: { trackingSystem: 'SAO_MIGUEL' },
    status: { in: ['PENDING', 'IN_TRANSIT'] },
  },
  select: { orderNumber: true, nfNumber: true, senderCnpj: true, recipientCnpj: true, lastTracking: true },
  orderBy: { createdAt: 'desc' },
  take: 20,
})

console.log(`Total São Miguel PENDING/IN_TRANSIT: ${orders.length}`)
console.log('')

for (const o of orders) {
  const cnpj = o.senderCnpj?.replace(/\D/g, '') ?? ''
  const nf = o.nfNumber ?? ''
  const result = await testNF(cnpj, nf)
  console.log(`${o.orderNumber} | NF: ${nf} | CNPJ: ${cnpj} → ${result}`)
  console.log(`  lastTracking: ${o.lastTracking ?? 'null'}`)
}

await prisma.$disconnect()
