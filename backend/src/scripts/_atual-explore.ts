const ATUAL_LOGIN_URL = 'https://cliente.atualcargas.com.br/api/cadastro/login'
const ATUAL_DOCUMENT  = process.env.ATUAL_CARGAS_DOCUMENT ?? '47715256000149'
const ATUAL_PASSWORD  = process.env.ATUAL_CARGAS_PASSWORD ?? '925196'

async function login(): Promise<string> {
  const res = await fetch(ATUAL_LOGIN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: ATUAL_DOCUMENT, password: ATUAL_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/painel-cliente\/iron-session=([^;]+)/)
  if (!match) throw new Error('Login falhou')
  return `painel-cliente/iron-session=${match[1]}`
}

async function tryUrl(cookie: string, url: string, label: string) {
  const r = await fetch(url, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) })
  const text = await r.text()
  console.log(`\n[${label}] HTTP ${r.status}: ${text.substring(0, 600)}`)
}

async function main() {
  const cookie = await login()
  const cnpj = '47715256000149'
  const base = `https://cliente.atualcargas.com.br/api/rastreamento/senha/lista-encomendas?cnpj=${cnpj}&tipo=remetente`

  // Vários formatos de filtro de data
  await tryUrl(cookie, `${base}&dataInicio=25/01/2026&dataFim=15/02/2026`, 'data BR jan-fev')
  await tryUrl(cookie, `${base}&dataInicio=2026-01-25&dataFim=2026-02-15`, 'data ISO jan-fev')
  await tryUrl(cookie, `${base}&inicio=25/01/2026&fim=15/02/2026`, 'inicio/fim BR')
  await tryUrl(cookie, `${base}&de=25/01/2026&ate=15/02/2026`, 'de/ate BR')
  await tryUrl(cookie, `${base}&periodo=30`, 'periodo=30')
  await tryUrl(cookie, `${base}&dias=30`, 'dias=30')
  await tryUrl(cookie, `${base}&page=1&perPage=50`, 'paginação perPage')
}
main().catch(console.error)
