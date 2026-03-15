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
  const payload = JSON.stringify({
    message: 'esm_decripter',
    expired_in: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  })
  const salt = randomBytes(8)
  const { key, iv } = smEvpBytesToKey(SM_APP_KEY, salt, 32, 16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from('Salted__'), salt, encrypted]).toString('base64')
}

// NF de teste — troque por uma NF real da São Miguel
const cnpj = '47715256000149' // AVIC
const nf = '9414'

const token = smCreateToken()
console.log('Testando proxy:', PROXY_URL)
console.log('NF:', nf, '| CNPJ:', cnpj)

try {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ cpfcnpj: cnpj, numberdocument: nf, serie: '', documentType: 'NFE' }),
  })

  console.log('HTTP status:', res.status)
  const text = await res.text()
  console.log('Resposta:', text.substring(0, 500))
} catch (err) {
  console.error('Erro:', err.message)
}
