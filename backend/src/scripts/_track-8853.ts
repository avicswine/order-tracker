import { PrismaClient } from '@prisma/client'

const ATUAL_LOGIN_URL = 'https://cliente.atualcargas.com.br/api/cadastro/login'
const ATUAL_LIST_URL  = 'https://cliente.atualcargas.com.br/api/rastreamento/senha/lista-encomendas'
const ATUAL_DOCUMENT  = process.env.ATUAL_CARGAS_DOCUMENT ?? '47715256000149'
const ATUAL_PASSWORD  = process.env.ATUAL_CARGAS_PASSWORD ?? '925196'

async function main() {
  // Login
  const res = await fetch(ATUAL_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: ATUAL_DOCUMENT, password: ATUAL_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/painel-cliente\/iron-session=([^;]+)/)
  if (!match) { console.log('Login falhou'); return }
  const cookie = `painel-cliente/iron-session=${match[1]}`

  // Lista
  const cnpj = '47715256000149'
  const url = new URL(ATUAL_LIST_URL)
  url.searchParams.set('cnpj', cnpj)
  url.searchParams.set('tipo', 'remetente')
  const r = await fetch(url.toString(), { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) })
  const data = await r.json() as { encomendasList?: unknown[] }
  const list = data.encomendasList ?? []
  console.log(`Total encomendas retornadas: ${list.length}`)
  // Mostra todas as NFs para ver o formato
  for (const e of list as Record<string, unknown>[]) {
    console.log('notaFiscal:', e.notaFiscal, '| situacao:', e.situacao, '| dataUltima:', e.dataUltimaOcorrencia)
  }
}
main().catch(console.error)
