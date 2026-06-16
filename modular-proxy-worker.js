/**
 * Cloudflare Worker — proxy para a API de rastreio da Modular Cargas
 * Contorna o bloqueio de IP de datacenter (Railway recebe 403 direto).
 *
 * Deploy:
 * 1. Acesse https://workers.cloudflare.com (mesma conta do sm-proxy)
 * 2. Crie um novo Worker (ex: modular-proxy)
 * 3. Cole este código e faça Deploy
 * 4. Copie a URL (ex: https://modular-proxy.SEU-USUARIO.workers.dev)
 * 5. Adicione no Railway: MODULAR_PROXY_URL=https://modular-proxy.SEU-USUARIO.workers.dev
 *
 * Uso: POST {URL}/{caminho}  — ex: /rastrear/listar  ou  /rastrear/listar/posicao
 * O corpo (form-urlencoded) é repassado para www.modular.com.br.
 */
export default {
  async fetch(request) {
    const url = new URL(request.url)
    // o caminho da requisição vira o caminho na Modular
    const target = `https://www.modular.com.br${url.pathname}`

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    const body = await request.text()

    const resp = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Origin': 'https://www.modular.com.br',
        'Referer': 'https://www.modular.com.br/rastrear',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      body,
    })

    const text = await resp.text()
    return new Response(text, {
      status: resp.status,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  },
}
