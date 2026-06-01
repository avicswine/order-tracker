/**
 * railway run node backend/test-nf.mjs
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const ATUAL_LOGIN_URL = 'https://cliente.atualcargas.com.br/api/cadastro/login'
const ATUAL_LIST_URL  = 'https://cliente.atualcargas.com.br/api/rastreamento/senha/lista-encomendas'
const ATUAL_DOCUMENT  = process.env.ATUAL_CARGAS_DOCUMENT ?? '47715256000149'
const ATUAL_PASSWORD  = process.env.ATUAL_CARGAS_PASSWORD ?? '925196'

const order = await prisma.order.findFirst({
  where: { nfNumber: { in: ['9116', '009116'] }, orderNumber: { startsWith: 'AVIC' } },
  include: { carrier: true },
})

if (!order) {
  console.log('Pedido não encontrado no banco')
  process.exit(0)
}

console.log('Pedido:', order.orderNumber)
console.log('Status:', order.status)
console.log('Carrier:', order.carrier?.name, '|', order.carrier?.trackingSystem)
console.log('lastTracking:', order.lastTracking)
console.log('senderCnpj:', order.senderCnpj)
console.log('nfNumber:', order.nfNumber)

const cnpj = order.senderCnpj?.replace(/\D/g, '') ?? ''
const nfBusca = String(parseInt(order.nfNumber ?? '0', 10))
console.log(`\nCNPJ limpo: ${cnpj}`)
console.log(`NF buscada: ${nfBusca}`)

// Login
console.log('\nFazendo login na Atual Cargas...')
const loginRes = await fetch(ATUAL_LOGIN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ document: ATUAL_DOCUMENT, password: ATUAL_PASSWORD }),
  signal: AbortSignal.timeout(15000),
})
console.log('Login HTTP:', loginRes.status)

if (!loginRes.ok) {
  console.log('Erro no login:', await loginRes.text())
  process.exit(1)
}

const setCookie = loginRes.headers.get('set-cookie') ?? ''
const match = setCookie.match(/painel-cliente\/iron-session=([^;]+)/)
if (!match) {
  console.log('Cookie não encontrado. set-cookie:', setCookie.substring(0, 200))
  process.exit(1)
}
const cookie = `painel-cliente/iron-session=${match[1]}`
console.log('Login OK')

// Busca lista por CNPJ remetente
const url = new URL(ATUAL_LIST_URL)
url.searchParams.set('cnpj', cnpj)
url.searchParams.set('tipo', 'remetente')
console.log(`\nBuscando lista: ${url.toString()}`)

const listRes = await fetch(url.toString(), {
  headers: { Cookie: cookie },
  signal: AbortSignal.timeout(15000),
})
console.log('Lista HTTP:', listRes.status)

if (!listRes.ok) {
  console.log('Erro na lista:', await listRes.text())
  process.exit(1)
}

const data = await listRes.json()
const list = data.encomendasList ?? []
console.log(`Total de encomendas retornadas: ${list.length}`)

if (list.length > 0) {
  console.log('\nPrimeiras 5 encomendas (campo notaFiscal):')
  list.slice(0, 5).forEach((e, i) => {
    console.log(`  [${i}] notaFiscal="${e.notaFiscal}" situacao="${e.situacao}" titulo="${e.tituloOcorrencia}"`)
  })
}

// Tenta encontrar NF 3167
const found = list.find((e) => {
  const partes = (e.notaFiscal ?? '').trim().split(/\s+/)
  const nfNum = String(parseInt(partes[partes.length - 1] ?? '0', 10))
  return nfNum === nfBusca
})

if (found) {
  console.log('\n✅ NF encontrada:')
  console.log(JSON.stringify(found, null, 2))
} else {
  console.log(`\n❌ NF ${nfBusca} NÃO encontrada na lista`)
  console.log('\nTentando busca por destinatário...')
  const url2 = new URL(ATUAL_LIST_URL)
  url2.searchParams.set('cnpj', cnpj)
  url2.searchParams.set('tipo', 'destinatario')
  const listRes2 = await fetch(url2.toString(), {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(15000),
  })
  const data2 = await listRes2.json()
  const list2 = data2.encomendasList ?? []
  console.log(`Total como destinatário: ${list2.length}`)
  const found2 = list2.find((e) => {
    const partes = (e.notaFiscal ?? '').trim().split(/\s+/)
    const nfNum = String(parseInt(partes[partes.length - 1] ?? '0', 10))
    return nfNum === nfBusca
  })
  if (found2) {
    console.log('✅ Encontrada como DESTINATÁRIO:')
    console.log(JSON.stringify(found2, null, 2))
    console.log('\n⚠️  A query usa tipo=remetente mas a NF está registrada como destinatário!')
  } else {
    console.log('❌ Não encontrada como destinatário também')
  }
}

await prisma.$disconnect()
