/**
 * Cloudflare Worker — proxy para API do Expresso São Miguel
 * Deploy: https://workers.cloudflare.com (conta gratuita, 100k req/dia)
 *
 * 1. Acesse workers.cloudflare.com
 * 2. Crie um novo Worker
 * 3. Cole este código
 * 4. Deploy
 * 5. Copie a URL do Worker (ex: sm-proxy.SEU-USUARIO.workers.dev)
 * 6. Adicione no Railway: SM_PROXY_URL=https://sm-proxy.SEU-USUARIO.workers.dev
 */

export default {
  async fetch(request) {
    const SM_URL = 'https://srv.expressosaomiguel.com.br:40490/api-portal-cliente/tracks'

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      })
    }

    const body = await request.text()
    const auth = request.headers.get('Authorization') || ''

    const response = await fetch(SM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept': 'application/json, text/plain, */*',
        'Authorization': auth,
        'Origin': 'https://portaldocliente.expressosaomiguel.com.br',
        'Referer': 'https://portaldocliente.expressosaomiguel.com.br/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body,
    })

    const responseBody = await response.text()

    return new Response(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  },
}
