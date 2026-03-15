/**
 * Testa o rastreamento São Miguel completo (como faz o sync real)
 * railway run node backend/test-sm-sync.mjs
 */
import { PrismaClient } from '@prisma/client'
import { createCipheriv, createHash, randomBytes } from 'crypto'

const prisma = new PrismaClient()
const SM_APP_KEY = 'Sx8AHhuIpDZYfY5GlzOzrlG1fYlhl4HD'
const SM_API_URL = process.env.SM_PROXY_URL || 'https://srv.expressosaomiguel.com.br:40490/api-portal-cliente/tracks'

console.log('SM_PROXY_URL:', SM_API_URL)

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
  select: { orderNumber: true, nfNumber: true, senderCnpj: true, recipientCnpj: true },
  take: 5,
})

for (const o of orders) {
  const cnpj = o.senderCnpj?.replace(/\D/g, '') ?? ''
  const nf = String(parseInt(o.nfNumber ?? '0', 10))
  const token = smCreateToken()

  console.log(`\n--- ${o.orderNumber} | NF: ${nf} | CNPJ: ${cnpj} ---`)
  try {
    const res = await fetch(SM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept': 'application/json, text/plain, */*',
        'Authorization': `Bearer ${token}`,
        'Origin': 'https://portaldocliente.expressosaomiguel.com.br',
        'Referer': 'https://portaldocliente.expressosaomiguel.com.br/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({ cpfcnpj: cnpj, numberdocument: nf, serie: '', documentType: 'NFE' }),
      signal: AbortSignal.timeout(15000),
    })
    console.log('HTTP:', res.status, res.headers.get('content-type'))
    const text = await res.text()
    console.log('Body:', text.substring(0, 300))
  } catch (e) {
    console.log('ERRO:', e.message)
  }
}

await prisma.$disconnect()
