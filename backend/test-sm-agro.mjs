import { createCipheriv, createHash, randomBytes } from 'crypto'

const SM_APP_KEY = 'Sx8AHhuIpDZYfY5GlzOzrlG1fYlhl4HD'
const PROXY_URL = 'https://little-lab-f6c5.avicswine.workers.dev'

function smEvpBytesToKey(passphrase, salt, keyLen, ivLen) {
  const totalLen = keyLen + ivLen
  let derived = Buffer.alloc(0)
  let block = Buffer.alloc(0)
  while (derived.length < totalLen) {
    const hash = createHash('md5')
    hash.update(block)
    hash.update(Buffer.from(passphrase, 'utf8'))
    hash.update(salt)
    block = hash.digest()
    derived = Buffer.concat([derived, block])
  }
  return { key: derived.subarray(0, keyLen), iv: derived.subarray(keyLen, keyLen + ivLen) }
}

function smCreateToken() {
  const payload = JSON.stringify({ message: 'esm_decripter', expired_in: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
  const salt = randomBytes(8)
  const { key, iv } = smEvpBytesToKey(SM_APP_KEY, salt, 32, 16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from('Salted__'), salt, encrypted]).toString('base64')
}

async function test(cnpj, nf) {
  const token = smCreateToken()
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ cpfcnpj: cnpj, numberdocument: nf, serie: '', documentType: 'NFE' }),
  })
  const text = await res.text()
  console.log(`CNPJ: ${cnpj} | NF: ${nf} → HTTP ${res.status} | ${text.substring(0, 200)}`)
}

// AGRO
await test('54695386000122', '3191')
await test('54695386000122', '003191')
await test('54695386000122', '3181')
// AVIC
await test('47715256000149', '9414')
await test('47715256000149', '9404')
