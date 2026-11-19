// Testa URLs candidatas do site público da Braspress
async function tryUrl(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' })
    console.log(`[${r.status}] ${r.url}`)
  } catch (e) {
    console.log(`[ERRO] ${url} — ${(e as Error).message}`)
  }
}
async function main() {
  await tryUrl('https://www.braspress.com/rastreio')
  await tryUrl('https://www.braspress.com/rastreamento')
  await tryUrl('https://www.braspress.com/tracking')
  await tryUrl('https://www.braspress.com/acesso-rapido/rastreamento')
  await tryUrl('https://www.braspress.com/acesso-rapido/rastreio')
  await tryUrl('https://www.braspress.com/cliente/rastreamento')
  await tryUrl('https://www.braspress.com/consulta/rastreamento')
  await tryUrl('https://www.braspress.com/cotacao-e-servicos/rastreamento')
}
main().catch(console.error)
