/**
 * Monta a imagem do rastreio que vai anexada na resposta ao cliente no Mercado Livre.
 *
 * NÃO é uma foto da tela do painel: é uma página montada só para o cliente, desenhada e
 * fotografada pelo puppeteer (que o projeto já usa para raspar as transportadoras). Fazer
 * assim é o que permite ESCOLHER o que aparece.
 *
 * O que fica de FORA, de propósito: nome, CPF, endereço e telefone do cliente. O Mercado
 * Livre avisa "não inclua dados pessoais" na própria caixa de mensagem e a API modera por
 * PERSONAL_DATA. O cliente já sabe quem é — o que ele quer saber é onde está a encomenda.
 */
import puppeteer from 'puppeteer'

export type EventoRastreio = { data?: string | null; descricao?: string | null }

export type DadosImagem = {
  nfNumero: string
  transportadora?: string | null
  previsao?: Date | string | null
  eventos: EventoRastreio[]
}

const escapar = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))

/**
 * Tira da descrição do evento o que for dado pessoal reconhecível.
 *
 * A descrição é TEXTO LIVRE da transportadora: vem do campo `observacao` do rastreamento
 * e às vezes traz documento ou telefone de quem recebeu. Como não dá para prometer que a
 * imagem está limpa sem olhar o texto, o que é reconhecível por formato sai aqui.
 * Nome de pessoa não é detectável com segurança — por isso a tela não promete isso.
 */
export function limparDadoPessoal(texto: string): string {
  return String(texto ?? '')
    // CPF e CNPJ, com ou sem pontuação
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[documento]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[documento]')
    // telefone com DDD
    .replace(/\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g, '[telefone]')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const dataBR = (d?: Date | string | null): string => {
  if (!d) return '—'
  const dt = d instanceof Date ? d : new Date(d)
  return isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('pt-BR')
}

/** O HTML da imagem. Separado para dar para conferir o conteúdo sem abrir o navegador. */
export function htmlDaImagem(d: DadosImagem): string {
  const eventos = (d.eventos || []).slice(0, 5)
  const linhas = eventos.length
    ? eventos.map((e, i) => `
        <li class="${i === 0 ? 'atual' : ''}">
          <span class="bolinha"></span>
          <div><b>${escapar(limparDadoPessoal(String(e.descricao ?? ''))) || '—'}</b>
          <small>${escapar(e.data)}</small></div>
        </li>`).join('')
    : '<li><div><b>Ainda sem movimentação registrada</b></div></li>'

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { width: 760px; font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
           background: #fff; color: #1e293b; padding: 28px 32px; }
    h1 { font-size: 20px; letter-spacing: -.3px; }
    .cab { border-bottom: 2px solid #e2e8f0; padding-bottom: 14px; margin-bottom: 18px; }
    .cab small { color: #64748b; font-size: 13px; }
    .campos { display: flex; gap: 40px; margin-bottom: 22px; }
    .campo small { display: block; color: #64748b; font-size: 12px;
                   text-transform: uppercase; letter-spacing: .4px; margin-bottom: 3px; }
    .campo b { font-size: 16px; }
    ul { list-style: none; }
    li { display: flex; gap: 12px; padding: 9px 0; border-bottom: 1px solid #f1f5f9; }
    li:last-child { border-bottom: 0; }
    .bolinha { width: 9px; height: 9px; border-radius: 50%; background: #cbd5e1;
               margin-top: 6px; flex-shrink: 0; }
    .atual .bolinha { background: #2563eb; }
    .atual b { color: #1d4ed8; }
    li b { font-size: 14px; font-weight: 600; display: block; }
    li small { color: #64748b; font-size: 12px; }
    .rodape { margin-top: 20px; padding-top: 12px; border-top: 2px solid #e2e8f0;
              color: #94a3b8; font-size: 12px; }
  </style></head><body>
    <div class="cab">
      <h1>Rastreamento da sua compra</h1>
      <small>Nota fiscal ${escapar(d.nfNumero)}</small>
    </div>
    <div class="campos">
      <div class="campo"><small>Transportadora</small><b>${escapar(d.transportadora) || '—'}</b></div>
      <div class="campo"><small>Previsão de entrega</small><b>${dataBR(d.previsao)}</b></div>
    </div>
    <ul>${linhas}</ul>
    <div class="rodape">Informação da transportadora, atualizada em ${dataBR(new Date())}.</div>
  </body></html>`
}

/** Desenha o HTML e devolve o PNG pronto para anexar. */
export async function gerarImagemRastreio(d: DadosImagem): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    timeout: 30000,
  })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 760, height: 600, deviceScaleFactor: 2 })
    await page.setContent(htmlDaImagem(d), { waitUntil: 'load' })
    const png = await page.screenshot({ type: 'png', fullPage: true })
    return Buffer.from(png)
  } finally {
    await browser.close()
  }
}
