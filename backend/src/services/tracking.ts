import axios from 'axios'
import * as cheerio from 'cheerio'
import puppeteer, { type Page } from 'puppeteer'
import { createWorker } from 'tesseract.js'
import { createCipheriv, createHash, randomBytes } from 'crypto'
import { OrderStatus } from '@prisma/client'

export interface TrackingEvent {
  date?: Date | null
  description: string
}

export interface TrackingResult {
  status: OrderStatus | null
  lastEvent: string | null
  shippedAt?: Date | null         // data de coleta / envio (do carrier)
  estimatedDelivery?: Date | null // previsão de entrega (do carrier)
  hasOccurrence?: boolean         // intercorrência ativa (problema na entrega)
  events?: TrackingEvent[]        // histórico completo de eventos
  raw?: unknown
}

// Parseia datas no formato brasileiro (dd/MM/yyyy ou dd/MM/yy) e ISO
function parseBrDate(str: string | undefined | null): Date | null {
  if (!str) return null
  const s = str.trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d
  }
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})(?:[T\s]+(\d{2}):(\d{2}))?/)
  if (m) {
    let year = parseInt(m[3], 10)
    if (year < 100) year += 2000
    const d = new Date(year, parseInt(m[2], 10) - 1, parseInt(m[1], 10), m[4] ? parseInt(m[4], 10) : 0, m[5] ? parseInt(m[5], 10) : 0)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

// Detecta se um texto representa uma intercorrência (problema na entrega)
function detectOccurrence(text: string): boolean {
  const t = text.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return (
    t.includes('TENTATIVA DE ENTREGA') ||
    t.includes('DESTINATARIO AUSENTE') ||
    t.includes('ENDERECO NAO ENCONTRADO') ||
    t.includes('ENDERECO INCORRETO') ||
    t.includes('ESTABELECIMENTO FECHADO') ||
    t.includes('AVARIA') ||
    t.includes('EXTRAVIO') ||
    t.includes('RETIDO') ||
    t.includes('RECUSADO') ||
    t.includes('SUSTADO') ||
    t.includes('IMPEDIMENTO') ||
    (t.includes('OCORRENCIA') && !t.includes('SEM OCORRENCIA') && !t.includes('OCORRENCIA DE ENTREGA'))
  )
}

// Mapeia texto de ocorrência para nosso enum de status
function mapStatus(text: string): OrderStatus | null {
  const t = text.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (t.includes('ENTREGUE') || t.includes('ENTREGA REALIZADA') || t.includes('ENTREGA EFETUADA') || t.includes('OCORRENCIA DE ENTREGA')) return OrderStatus.DELIVERED
  if (t.includes('DEVOLV') || t.includes('RETORNO') || t.includes('CANCELAD')) return OrderStatus.CANCELLED
  if (
    t.includes('SAIU PARA ENTREGA') || t.includes('EM ROTA') || t.includes('SAIDA PARA ENTREGA') ||
    t.includes('EM TRANSITO') || t.includes('TRANSFERENCIA') || t.includes('COLETADO') ||
    t.includes('COLETA REALIZADA') || t.includes('EXPEDIDO') || t.includes('EM DISTRIBUICAO') ||
    t.includes('CHEGADA EM UNIDADE') || t.includes('CHEGADA NA UNIDADE') || t.includes('EM SEPARACAO') ||
    t.includes('RECEBIDO') || t.includes('AGUARDANDO') ||
    t.includes('TRANSBORDO') || t.includes('MANIFESTADO') || t.includes('CONHECIMENTO EMITIDO')
  ) return OrderStatus.IN_TRANSIT
  return null
}

// --- SSW ---
// O HTML mostra apenas eventos mas o CSV (link "Download em CSV") expõe
// "Previsao de Entrega" e "Data Entrega" — colunas não visíveis no HTML.
export async function trackSSW(
  senderCnpj: string,
  nfNumber: string,
  siglaEmp?: string
): Promise<TrackingResult> {
  const cnpj = senderCnpj.replace(/\D/g, '')
  const nf = String(parseInt(nfNumber, 10)) // remove zeros à esquerda

  const params = new URLSearchParams({ cnpj, NR: nf })
  if (siglaEmp) params.append('sigla_emp', siglaEmp)

  const response = await axios.post('https://ssw.inf.br/2/ssw_resultSSW', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  })

  const $ = cheerio.load(response.data as string)

  // Estrutura SSW: tabela com 3 colunas — "N Fiscal | Unidade/Data | Situação"
  let lastEvent: string | null = null
  let shippedAt: Date | null = null
  let estimatedDelivery: Date | null = null
  let hasOccurrence = false
  const SKIP = ['situação', 'download', 'remetente', 'voltar', 'n fiscal', 'csv']
  const allEvents: TrackingEvent[] = []

  $('table tr').each((_i, row) => {
    const cells = $(row).find('td')
    if (cells.length === 3) {
      const cell2 = $(cells[2])
      cell2.find('a, button').remove()
      const situacao = cell2.text().trim().replace(/\s+/g, ' ')
      const situacaoLower = situacao.toLowerCase()

      if (!situacao || SKIP.some((s) => situacaoLower.includes(s))) return

      // Extrai data da coluna 1 (Unidade/Data)
      const col1Text = $(cells[1]).text().trim()
      const dateStr = col1Text.match(/(\d{2}\/\d{2}\/\d{2,4}(?:\s+\d{2}:\d{2})?)/)?.[1]
      const eventDate = parseBrDate(dateStr)

      if (eventDate && !shippedAt) shippedAt = eventDate
      if (detectOccurrence(situacao)) hasOccurrence = true
      lastEvent = situacao
      allEvents.push({ date: eventDate, description: situacao })
    }
  })

  // Busca previsão de entrega via CSV — contém colunas "Previsao de Entrega" e "Data Entrega"
  // que não aparecem no HTML. O link de download está no HTML como "Download em CSV".
  const csvHref = $('a').filter((_i, el) => $(el).text().toLowerCase().includes('csv')).attr('href')
  if (csvHref) {
    try {
      const csvUrl = csvHref.startsWith('http') ? csvHref : `https://ssw.inf.br${csvHref}`
      const csvRes = await axios.get(csvUrl, { timeout: 10000, responseType: 'text' })
      const csvText = csvRes.data as string

      // CSV com separador ';', primeira linha = cabeçalho
      const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0)
      if (lines.length >= 2) {
        const headers = lines[0].split(';').map(h => h.trim().toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
        const idxPrev = headers.findIndex(h => h.includes('previsao') && h.includes('entrega'))
        const idxEntrega = headers.findIndex(h => h === 'data entrega' || (h.includes('data') && h.includes('entrega') && !h.includes('previsao')))

        // Agrega todas as linhas de dados (pode haver múltiplos eventos)
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(';')
          if (idxPrev >= 0 && cols[idxPrev]?.trim()) {
            estimatedDelivery = parseBrDate(cols[idxPrev].trim())
          }
          // Data de entrega real (quando DELIVERED) — sobrescreve shippedAt se for mais precisa
          if (idxEntrega >= 0 && cols[idxEntrega]?.trim() && !shippedAt) {
            shippedAt = parseBrDate(cols[idxEntrega].trim())
          }
        }
      }
    } catch {
      // falha silenciosa — já temos o evento do HTML
    }
  }

  return {
    status: lastEvent ? mapStatus(lastEvent) : null,
    lastEvent,
    shippedAt,
    estimatedDelivery,
    hasOccurrence: hasOccurrence || undefined,
    events: allEvents.length > 0 ? [...allEvents].reverse() : undefined, // mais recente primeiro
  }
}

// --- Senior TCK ---
// A API Senior tem dois formatos de resposta dependendo da configuração do tenant:
//
// Formato A (simples): listaTracking = [ { data, situacao, descricao, ... }, ... ]
//   previsão fica na raiz: data.previsaoEntrega / data.dtPrevEntrega
//
// Formato B (aninhado, ex: TRD): listaTracking = [ { tracking: { dataPrevisaoEntrega, situacao }, listaTrackingFase: [...] } ]
//   previsão fica em: listaTracking[0].tracking.dataPrevisaoEntrega (ISO)
//   eventos ficam em: listaTrackingFase[N] = { sequencia, executada, dataExecucao, observacao, fase: { descricao } }

export async function trackSenior(
  senderCnpj: string,
  nfNumber: string,
  tenant: string
): Promise<TrackingResult> {
  const cnpj = senderCnpj.replace(/\D/g, '')
  const nf = String(parseInt(nfNumber, 10))

  const response = await axios.post(
    'https://platform.senior.com.br/t/senior.com.br/bridge/1.0/anonymous/rest/tms/tck/actions/externalTenantConsultaTracking',
    { inscricaoFiscal: cnpj, documento: nf },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': tenant,
        'X-TenantDomain': `${tenant}.senior.com.br`,
      },
      timeout: 15000,
    }
  )

  const data = response.data as Record<string, unknown>
  const rawList = (data.listaTracking ?? data.trackings ?? []) as Record<string, unknown>[]

  if (!Array.isArray(rawList) || rawList.length === 0) {
    return { status: null, lastEvent: null }
  }

  // Detecta formato aninhado (Formato B): primeiro item tem sub-objeto "tracking" + "listaTrackingFase"
  const firstItem = rawList[0]
  if (firstItem.tracking !== undefined && Array.isArray(firstItem.listaTrackingFase)) {
    // --- Formato B (TRD e similares) ---
    const tracking = firstItem.tracking as Record<string, unknown>
    const fases = (firstItem.listaTrackingFase as Record<string, unknown>[])
      .filter((f) => f.executada !== false)
      .sort((a, b) => ((a.sequencia as number) ?? 0) - ((b.sequencia as number) ?? 0))

    const firstFase = fases[0]
    const lastFase = fases[fases.length - 1]

    // Data de envio = primeira fase executada
    const shippedAt = firstFase?.dataExecucao ? new Date(firstFase.dataExecucao as string) : null

    // Previsão de entrega = campo ISO no objeto tracking
    const prevRaw = tracking.dataPrevisaoEntrega as string | undefined
    const estimatedDelivery = prevRaw ? new Date(prevRaw) : null

    // Evento mais recente: preferência para observacao (texto real) sobre fase.descricao (nome técnico)
    const lastFaseFase = lastFase?.fase as Record<string, unknown> | undefined
    const lastEvent =
      (lastFase?.observacao as string | undefined) ||
      (lastFaseFase?.descricao as string | undefined) ||
      (tracking.situacao as Record<string, unknown> | undefined)?.descricao as string | undefined ||
      null

    const hasOccurrence = fases.some((f) => {
      const obs = (f.observacao as string) ?? ''
      const desc = ((f.fase as Record<string, unknown> | undefined)?.descricao as string) ?? ''
      return detectOccurrence(obs || desc)
    })

    const events: TrackingEvent[] = fases
      .map((f) => ({
        date: f.dataExecucao ? new Date(f.dataExecucao as string) : null,
        description:
          (f.observacao as string | undefined) ||
          ((f.fase as Record<string, unknown> | undefined)?.descricao as string | undefined) ||
          '',
      }))
      .filter((e) => e.description)
      .reverse() // mais recente primeiro

    return {
      status: lastEvent ? mapStatus(lastEvent) : null,
      lastEvent,
      shippedAt,
      estimatedDelivery: isNaN(estimatedDelivery?.getTime() ?? NaN) ? null : estimatedDelivery,
      hasOccurrence: hasOccurrence || undefined,
      events: events.length > 0 ? events : undefined,
    }
  }

  // --- Formato A (simples) ---
  const list = rawList

  let lastEvent: string | null = null
  let shippedAt: Date | null = null
  let estimatedDelivery: Date | null = null
  let hasOccurrence = false

  // Primeiro item = evento mais antigo (coleta/envio)
  const first = list[0]
  const firstDateStr = (first.data ?? first.dataOcorrencia ?? first.datahora) as string | undefined
  const firstHora = (first.hora ?? '') as string
  shippedAt = parseBrDate(firstDateStr ? `${firstDateStr} ${firstHora}`.trim() : null)

  // Último item = evento mais recente
  const last = list[list.length - 1]
  lastEvent =
    (last.situacao as string | undefined) ??
    (last.descricao as string | undefined) ??
    (last.fase as string | undefined) ??
    (last.status as string | undefined) ??
    null

  // Previsão de entrega: campo explícito na raiz da resposta
  const prevRaw = (data.previsaoEntrega ?? data.dtPrevEntrega ?? data.previsao) as string | undefined
  estimatedDelivery = parseBrDate(prevRaw)

  // Intercorrências
  hasOccurrence = list.some((item) => detectOccurrence((item.situacao ?? item.descricao ?? '') as string))

  const events: TrackingEvent[] = list
    .map((item) => {
      const dateStr = (item.data ?? item.dataOcorrencia ?? item.datahora) as string | undefined
      const hora = (item.hora ?? '') as string
      return {
        date: parseBrDate(dateStr ? `${dateStr} ${hora}`.trim() : null),
        description: ((item.situacao ?? item.descricao ?? item.fase ?? item.status ?? '') as string),
      }
    })
    .filter((e) => e.description)
    .reverse() // mais recente primeiro (list é mais antigo primeiro)

  return {
    status: lastEvent ? mapStatus(lastEvent) : null,
    lastEvent,
    shippedAt,
    estimatedDelivery,
    hasOccurrence: hasOccurrence || undefined,
    events: events.length > 0 ? events : undefined,
  }
}

// --- Puppeteer: portais com CAPTCHA ---

// Despachante: escolhe a implementação baseado no código do portal
export async function trackWithPuppeteer(
  senderCnpj: string,
  nfNumber: string,
  portalCode: string
): Promise<TrackingResult> {
  switch (portalCode.toUpperCase()) {
    case 'EXPRESSO_SAO_MIGUEL':
      return trackExpressoSaoMiguel(senderCnpj, nfNumber)
    default:
      throw new Error(`Portal não implementado para rastreamento: ${portalCode}`)
  }
}

// Tenta preencher um input tentando seletores em ordem até o primeiro que funcionar
async function fillInput(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const el = await page.$(selector)
      if (el) {
        await el.click({ clickCount: 3 }) // seleciona tudo antes de digitar
        await el.type(value, { delay: 30 })
        console.log(`[ESM] Preencheu campo "${selector}"`)
        return true
      }
    } catch {
      // tenta o próximo seletor
    }
  }
  return false
}

// Usa Tesseract.js para ler o código alfanumérico do CAPTCHA
async function solveCaptcha(imageBuffer: Buffer): Promise<string | null> {
  const worker = await createWorker('eng')
  try {
    await worker.setParameters({
      // CAPTCHA é alfanumérico (ex: "j3xw") — inclui letras e números
      tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyz0123456789',
    })
    const { data } = await worker.recognize(imageBuffer)
    const code = data.text.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    // Aceita qualquer código de 3-6 caracteres
    return code.length >= 3 && code.length <= 6 ? code.slice(0, 4) : null
  } finally {
    await worker.terminate()
  }
}

// --- Expresso São Miguel ---
// Estrutura do formulário (descoberta via diagnóstico):
//   #isNFE / #isCTE / #isDCE — radio button para tipo de documento
//   #numberdocumento          — número da NF-e / CT-e
//   #cpfcnpj                  — CPF ou CNPJ
//   [id^="captcha"]           — input da resposta (ID dinâmico)
//   canvas 100x50             — imagem do CAPTCHA gerada via Canvas API
//
// Estratégia: interceptar CanvasRenderingContext2D.fillText antes da renderização
// para capturar o valor exato do CAPTCHA sem OCR (100% confiável).
async function trackExpressoSaoMiguel(
  senderCnpj: string,
  nfNumber: string
): Promise<TrackingResult> {
  const cnpj = senderCnpj.replace(/\D/g, '')
  const nf = String(parseInt(nfNumber, 10))

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    timeout: 30000,
  })

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const page = await browser.newPage()
      await page.setViewport({ width: 1366, height: 768 })

      try {
        // ANTES de navegar: injeta interceptor no canvas.fillText
        // Captura qualquer string de 3-6 chars alfanuméricos desenhada no canvas
        // (é exatamente o que o CAPTCHA faz ao ser gerado)
        await page.evaluateOnNewDocument(() => {
          const captured: string[] = []
          const orig = CanvasRenderingContext2D.prototype.fillText
          CanvasRenderingContext2D.prototype.fillText = function (
            text: string,
            ...args: Parameters<typeof orig> extends [unknown, ...infer R] ? R : never
          ) {
            if (/^[a-z0-9]{3,6}$/i.test(String(text))) {
              captured.push(String(text))
              ;(window as unknown as Record<string, unknown>).__captchaCapture = captured
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return orig.apply(this, [text, ...args] as any)
          }
        })

        await page.goto(
          'https://portaldocliente.expressosaomiguel.com.br/rastrear-mercadoria',
          { waitUntil: 'networkidle2', timeout: 30000 }
        )

        // Aguarda o formulário Ember.js renderizar
        await page.waitForSelector('#isNFE', { timeout: 15000 })

        // Lê o valor do CAPTCHA capturado pelo interceptor
        const captchaCode = await page.evaluate(() => {
          const captured = (window as unknown as Record<string, string[]>).__captchaCapture || []
          return captured[captured.length - 1] || null
        })
        console.log(`[ESM] Tentativa ${attempt} — CAPTCHA interceptado: "${captchaCode}"`)

        if (!captchaCode) {
          console.warn('[ESM] Interceptor não capturou CAPTCHA — tentando novamente')
          await page.close()
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }

        // Seleciona tipo NF-e
        await page.click('#isNFE')
        await new Promise((r) => setTimeout(r, 200))

        // Preenche campos do formulário
        if (!(await fillInput(page, ['#numberdocumento'], nf))) {
          throw new Error('Campo NF (#numberdocumento) não encontrado')
        }
        if (!(await fillInput(page, ['#cpfcnpj'], cnpj))) {
          throw new Error('Campo CNPJ (#cpfcnpj) não encontrado')
        }

        // Preenche o CAPTCHA com o valor exato capturado
        if (!(await fillInput(page, ['[id^="captcha"]', 'input[placeholder*="chave" i]'], captchaCode))) {
          throw new Error('Campo de resposta do CAPTCHA não encontrado')
        }
        console.log(`[ESM] Formulário preenchido — NF: ${nf}, CNPJ: ${cnpj.slice(0, 4)}..., CAPTCHA: ${captchaCode}`)

        // Clica no botão "Consultar"
        const submitOk = await page.evaluate(() => {
          /* eslint-disable @typescript-eslint/no-explicit-any */
          const btns = Array.from(document.querySelectorAll('button'))
          const consultar = btns.find((b: any) =>
            (b.innerText || b.textContent || '').toLowerCase().includes('consultar')
          ) as any
          if (consultar) { consultar.click(); return true }
          return false
        })
        if (!submitOk) throw new Error('Botão Consultar não encontrado')

        // Aguarda SPA processar e exibir resultados
        await new Promise((r) => setTimeout(r, 6000))

        // Screenshot do resultado para diagnóstico (apenas nas primeiras 2 tentativas)
        if (attempt <= 2) {
          const tmpDir = process.env.TEMP || process.env.TMP || '/tmp'
          await page.screenshot({ path: `${tmpDir}\\esm-result.png`, fullPage: true })
          console.log(`[ESM] Screenshot resultado: ${tmpDir}\\esm-result.png`)
        }

        const pageText = await page.evaluate(() => (document.body as HTMLElement).innerText)
        console.log('[ESM] Resultado (800 chars):', pageText.substring(0, 800))

        // Detecta erro de CAPTCHA inválido
        if (pageText.toLowerCase().includes('captcha') && pageText.toLowerCase().includes('informe')) {
          console.warn('[ESM] Servidor rejeitou CAPTCHA — tentando novamente')
          await page.close()
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }

        await page.close()

        const lastEvent = extractLastEventFromText(pageText)
        return {
          status: lastEvent ? mapStatus(lastEvent) : null,
          lastEvent,
        }
      } catch (err) {
        console.error(`[ESM] Tentativa ${attempt} falhou:`, (err as Error).message)
        await page.close().catch(() => {})
        if (attempt === 3) throw err
        await new Promise((r) => setTimeout(r, 2000))
      }
    }

    return { status: null, lastEvent: null }
  } finally {
    await browser.close()
  }
}

// --- Atual Cargas ---

const ATUAL_LOGIN_URL = 'https://cliente.atualcargas.com.br/api/cadastro/login'
const ATUAL_LIST_URL  = 'https://cliente.atualcargas.com.br/api/rastreamento/senha/lista-encomendas'
const ATUAL_DOCUMENT  = process.env.ATUAL_CARGAS_DOCUMENT ?? '47715256000149'
const ATUAL_PASSWORD  = process.env.ATUAL_CARGAS_PASSWORD ?? '925196'

let atualSessionCookie: string | null = null
let atualSessionExpires = 0

async function atualLogin(): Promise<string> {
  const res = await fetch(ATUAL_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: ATUAL_DOCUMENT, password: ATUAL_PASSWORD }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Atual login falhou: HTTP ${res.status}`)

  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = setCookie.match(/painel-cliente\/iron-session=([^;]+)/)
  if (!match) throw new Error('Atual: cookie de sessão não encontrado')

  // Sessão dura 59 min (3540s no portal) — renova com 5min de folga
  atualSessionExpires = Date.now() + 54 * 60 * 1000
  atualSessionCookie = `painel-cliente/iron-session=${match[1]}`
  return atualSessionCookie
}

async function atualGetCookie(): Promise<string> {
  if (atualSessionCookie && Date.now() < atualSessionExpires) return atualSessionCookie
  return atualLogin()
}

function atualMapStatus(situacao: string, titulo: string): OrderStatus | null {
  const s = (situacao + ' ' + titulo).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (s.includes('ENTREGUE') || s.includes('ENTREGA REALIZADA') || s.includes('ENTREGA EFETUADA')) return OrderStatus.DELIVERED
  if (s.includes('DEVOLV') || s.includes('CANCELAD') || s.includes('RETORNO')) return OrderStatus.CANCELLED
  return OrderStatus.IN_TRANSIT
}

export async function trackAtualCargas(
  senderCnpj: string,
  nfNumber: string
): Promise<TrackingResult> {
  const nfBusca = String(parseInt(nfNumber, 10))
  const cookie = await atualGetCookie()

  const url = new URL(ATUAL_LIST_URL)
  url.searchParams.set('cnpj', senderCnpj.replace(/\D/g, ''))
  url.searchParams.set('tipo', 'remetente')

  const res = await fetch(url.toString(), {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    // Sessão pode ter expirado — tenta renovar uma vez
    atualSessionCookie = null
    const cookie2 = await atualGetCookie()
    const res2 = await fetch(url.toString(), {
      headers: { Cookie: cookie2 },
      signal: AbortSignal.timeout(15000),
    })
    if (!res2.ok) throw new Error(`Atual Cargas API erro: HTTP ${res2.status}`)
    const data2 = await res2.json() as { encomendasList?: AtualEncomenda[] }
    return atualProcessList(data2.encomendasList ?? [], nfBusca)
  }

  const data = await res.json() as { encomendasList?: AtualEncomenda[] }
  return atualProcessList(data.encomendasList ?? [], nfBusca)
}

interface AtualEncomenda {
  notaFiscal?: string
  situacao?: string
  tituloOcorrencia?: string
  dataUltimaOcorrencia?: string
  dataPrevisaoEntrega?: string
  dtPrevEntrega?: string
  previsaoEntrega?: string
  emissao?: string          // data de emissão/envio (dd/MM/yy)
  emissaoParseIso?: string  // mesmo campo em formato ISO
}

function atualProcessList(list: AtualEncomenda[], nfBusca: string): TrackingResult {
  // A NF vem no formato "1  000009089" (série + número com zeros)
  // Extrai o último bloco numérico e remove zeros à esquerda para comparar
  const found = list.find((e) => {
    const partes = (e.notaFiscal ?? '').trim().split(/\s+/)
    const nfNum = String(parseInt(partes[partes.length - 1] ?? '0', 10))
    return nfNum === nfBusca
  })

  if (!found) return { status: null, lastEvent: `Não localizado (NF ${nfBusca})` }

  const lastEvent = [found.tituloOcorrencia, found.situacao].filter(Boolean).join(' — ') || found.situacao || null
  const shippedAt = parseBrDate(found.emissaoParseIso ?? found.emissao)
  const estimatedDelivery = parseBrDate(found.dataPrevisaoEntrega ?? found.dtPrevEntrega ?? found.previsaoEntrega)
  const hasOccurrence = detectOccurrence(found.tituloOcorrencia ?? found.situacao ?? '') || undefined

  return {
    status: atualMapStatus(found.situacao ?? '', found.tituloOcorrencia ?? ''),
    lastEvent,
    shippedAt,
    estimatedDelivery,
    hasOccurrence,
  }
}

// --- Rodonaves ---
// O site usa dois sistemas: RODO (endpoint v3/package) com fallback para BRUDAM (v3/brudam).
// O endpoint antigo /bin/tracking foi descontinuado e retorna HTTP 500.

const RODO_HEADERS = {
  'Accept': 'application/json',
  'Referer': 'https://www.rodonaves.com.br/rastreio-de-mercadoria',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
}

interface RodonavesEvent {
  Date: string
  Description: string
  EventCode: string
  HistoricId: number
}

interface RodonavesResponse {
  Events?: RodonavesEvent[]
  FiscalDocumentNumber?: string
  BillOfLadingId?: number
  EmissionDate?: string
  ExpectedDeliveryDays?: number
}

// Resposta do sistema Brudam (dados de frete terceirizado)
interface BrudamDado {
  data_ocorrencia?: string  // "DD/MM/YYYY HH:mm"
  ocorrencia?: string
  situacao?: string
}
interface BrudamItem {
  dados?: BrudamDado[]
  razao_destinatario?: string
}
interface BrudamResponse {
  success?: boolean
  data?: BrudamItem[]
}

function rodonavesMapStatus(eventCode: string, description: string): OrderStatus | null {
  const code = String(eventCode).trim()
  if (code === '6') return OrderStatus.DELIVERED
  const desc = description.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (desc.includes('DEVOLV') || desc.includes('RETORNO') || desc.includes('RECUSAD') || desc.includes('CANCELAD')) return OrderStatus.CANCELLED
  if (['0', '1', '1.1', '2', '3', '4', '5'].includes(code)) return OrderStatus.IN_TRANSIT
  return null
}

export async function trackRodonaves(
  senderCnpj: string,
  nfNumber: string
): Promise<TrackingResult> {
  const cnpj = senderCnpj.replace(/\D/g, '')
  const nf = String(parseInt(nfNumber, 10))

  // 1. Tenta sistema RODO (endpoint v3)
  try {
    const rodoUrl = `https://www.rodonaves.com.br/bin/rodonaves/trackingv3/package?TaxIdRegistration=${cnpj}&InvoiceNumber=${nf}`
    const rodoRes = await fetch(rodoUrl, { headers: RODO_HEADERS, signal: AbortSignal.timeout(15000) })

    if (rodoRes.ok) {
      const data = await rodoRes.json() as RodonavesResponse & Record<string, unknown>

      if (data.Events && data.Events.length > 0) {
        const sortedEvents = [...data.Events].sort((a, b) => new Date(b.Date).getTime() - new Date(a.Date).getTime())
        const last = sortedEvents[0]
        const oldest = sortedEvents[sortedEvents.length - 1]

        let estimatedDelivery: Date | null = null
        if (data.EmissionDate && data.ExpectedDeliveryDays) {
          const base = new Date(data.EmissionDate)
          if (!isNaN(base.getTime())) {
            const d = new Date(base)
            d.setDate(d.getDate() + data.ExpectedDeliveryDays)
            estimatedDelivery = d
          }
        }

        const hasOccurrence = sortedEvents.some((e) => detectOccurrence(e.Description)) || undefined
        const events: TrackingEvent[] = sortedEvents.map((e) => ({ date: e.Date ? new Date(e.Date) : null, description: e.Description }))

        return {
          status: rodonavesMapStatus(last.EventCode, last.Description),
          lastEvent: last.Description,
          shippedAt: oldest.Date ? new Date(oldest.Date) : null,
          estimatedDelivery,
          hasOccurrence,
          events: events.length > 0 ? events : undefined,
        }
      }
    }
  } catch {
    // cai para BRUDAM
  }

  // 2. Fallback: sistema BRUDAM
  const brudamUrl = `https://www.rodonaves.com.br/bin/rodonaves/trackingv3/brudam?documento=${cnpj}&numero=${nf}&prefixo=cnpjnf`
  const brudamRes = await fetch(brudamUrl, { headers: RODO_HEADERS, signal: AbortSignal.timeout(15000) })

  if (!brudamRes.ok) {
    return { status: null, lastEvent: `Erro: HTTP ${brudamRes.status}` }
  }

  const brudam = await brudamRes.json() as BrudamResponse

  if (!brudam.success || !brudam.data || brudam.data.length === 0 || !brudam.data[0].dados?.length) {
    return { status: null, lastEvent: `Não localizado (NF ${nf})` }
  }

  const dados = brudam.data[0].dados!
  const lastDado = dados[dados.length - 1]
  const lastEvent = lastDado.ocorrencia ?? lastDado.situacao ?? null

  const events: TrackingEvent[] = dados.map((d) => ({
    date: parseBrDate(d.data_ocorrencia),
    description: d.ocorrencia ?? d.situacao ?? '',
  })).filter((e) => e.description).reverse() // mais recente primeiro

  return {
    status: lastEvent ? mapStatus(lastEvent) : null,
    lastEvent,
    shippedAt: parseBrDate(dados[0]?.data_ocorrencia),
    events: events.length > 0 ? events : undefined,
  }
}

// --- Expresso São Miguel (API direta) ---

const SM_APP_KEY = 'Sx8AHhuIpDZYfY5GlzOzrlG1fYlhl4HD'
const SM_API_URL = 'https://srv.expressosaomiguel.com.br:40490/api-portal-cliente/tracks'

function smEvpBytesToKey(passphrase: string, salt: Buffer, keyLen: number, ivLen: number) {
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

function smCreateToken(): string {
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

function smMapStatus(control?: string, title?: string): OrderStatus | null {
  const c = (control ?? '').toUpperCase()
  if (c === 'ENTREGA' || c === 'ENTREGUE') return OrderStatus.DELIVERED
  if (['SAIU_ENTREGA', 'EM_EMTREGA', 'LOCAL_ENTREGA', 'CENTRO_DISTRIBUICAO', 'VIAGEM', 'EMISSAO'].includes(c)) return OrderStatus.IN_TRANSIT

  const t = (title ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (/entregu|entrega realizada/.test(t)) return OrderStatus.DELIVERED
  if (/devolv|devoluc/.test(t)) return OrderStatus.CANCELLED
  if (/saiu para entrega|unidade de destino|centro de distribui|em transito|em viagem|emissao|conhecimento/.test(t)) return OrderStatus.IN_TRANSIT
  return null
}

export async function trackSaoMiguel(
  senderCnpj: string,
  nfNumber: string,
  recipientCnpj?: string | null,
  tipo?: string | null
): Promise<TrackingResult> {
  const usarCnpj = (tipo === 'remetente' ? senderCnpj : (recipientCnpj ?? senderCnpj)).replace(/\D/g, '')
  const nf = String(parseInt(nfNumber, 10))
  const token = smCreateToken()

  const response = await fetch(SM_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept': 'application/json, text/plain, */*',
      'Authorization': `Bearer ${token}`,
      'Origin': 'https://portaldocliente.expressosaomiguel.com.br',
      'Referer': 'https://portaldocliente.expressosaomiguel.com.br/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({ cpfcnpj: usarCnpj, numberdocument: nf, serie: '', documentType: 'NFE' }),
    signal: AbortSignal.timeout(15000),
  })

  if (!response.ok) {
    let msg = `HTTP ${response.status}`
    try { const json = await response.json() as Record<string, unknown>; msg = (json.message ?? json.error ?? msg) as string } catch {}
    return { status: null, lastEvent: `Erro: ${msg}` }
  }

  const data = await response.json() as unknown[]

  if (!Array.isArray(data) || data.length === 0) {
    return { status: null, lastEvent: `Não localizado (NF ${nf} / CNPJ ${usarCnpj})` }
  }

  // Pega o evento mais recente do primeiro CT-e
  const cte = data[0] as Record<string, unknown> & {
    number?: number
    embark?: string
    expectedDate?: string    // previsão de entrega retornada pela API São Miguel
    dtPrevEntrega?: string
    previsaoEntrega?: string
    tracks?: { title?: string; date?: string; hour?: string; control?: string }[]
  }

  // embark = data de embarque/envio (formato dd/MM/yyyy ou similar)
  const shippedAt = parseBrDate(cte.embark)

  // Previsão de entrega: São Miguel retorna no campo "expectedDate"
  const estimatedDelivery = parseBrDate(
    cte.expectedDate ?? cte.dtPrevEntrega ?? cte.previsaoEntrega
  )

  if (!cte.tracks || cte.tracks.length === 0) {
    return {
      status: OrderStatus.IN_TRANSIT,
      lastEvent: `Emissão registrada (CT-e ${cte.number ?? ''} / Embarque ${cte.embark ?? ''})`,
      shippedAt,
      estimatedDelivery,
    }
  }

  // tracks[0] = mais recente; tracks[last] = mais antigo
  const lastTrack = cte.tracks[0]
  const lastEvent = lastTrack.title ?? null
  const hasOccurrence = cte.tracks.some((t) => detectOccurrence(t.title ?? '')) || undefined

  const events: TrackingEvent[] = cte.tracks
    .map((t) => ({
      date: t.date ? parseBrDate(`${t.date}${t.hour ? ' ' + t.hour : ''}`.trim()) : null,
      description: t.title ?? '',
    }))
    .filter((e) => e.description)
  // cte.tracks já vem mais recente primeiro

  return {
    status: smMapStatus(lastTrack.control, lastTrack.title),
    lastEvent,
    shippedAt,
    estimatedDelivery,
    hasOccurrence,
    events: events.length > 0 ? events : undefined,
    raw: data,
  }
}

// --- Braspress ---
// Autenticação: Basic Auth com credenciais fornecidas pela Braspress
// Variáveis de ambiente: BRASPRESS_USER e BRASPRESS_PASSWORD
// URL: GET https://api.braspress.com/v1/tracking/{cnpj}/{notaFiscal}/json

interface BraspressTracking {
  dataOcorrencia?: string
  ocorrencia?: string
  descricao?: string
  filial?: string
}

interface BraspressResponse {
  nroNfe?: string
  dtPrevEntrega?: string
  tracking?: BraspressTracking[]
}

function braspressAuth(): string {
  const user = process.env.BRASPRESS_USER ?? ''
  const pass = process.env.BRASPRESS_PASSWORD ?? ''
  if (!user || !pass) throw new Error('Credenciais da Braspress não configuradas (BRASPRESS_USER / BRASPRESS_PASSWORD)')
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
}

export async function trackBraspress(
  senderCnpj: string,
  nfNumber: string,
  _tipo?: string | null
): Promise<TrackingResult> {
  const cnpj = senderCnpj.replace(/\D/g, '')
  const nf = String(parseInt(nfNumber, 10))

  const url = `https://api.braspress.com/v1/tracking/${cnpj}/${nf}/json`

  const res = await fetch(url, {
    headers: {
      Authorization: braspressAuth(),
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const j = await res.json() as Record<string, unknown>; msg = (j.message ?? msg) as string } catch {}
    return { status: null, lastEvent: `Erro: ${msg}` }
  }

  const data = await res.json() as BraspressResponse

  const trackings = data.tracking ?? []
  if (trackings.length === 0) {
    return { status: null, lastEvent: `Não localizado (NF ${nf})` }
  }

  // Pega o último evento (mais recente)
  const last = trackings[trackings.length - 1]
  const descricao = last.descricao ?? last.ocorrencia ?? null

  const events: TrackingEvent[] = trackings
    .map((t) => ({
      date: parseBrDate(t.dataOcorrencia),
      description: t.descricao ?? t.ocorrencia ?? '',
    }))
    .filter((e) => e.description)
    .reverse() // mais recente primeiro

  return {
    status: descricao ? mapStatus(descricao) : null,
    lastEvent: descricao,
    events: events.length > 0 ? events : undefined,
    raw: data,
  }
}

// Extrai o evento mais recente do texto bruto da página de resultado
function extractLastEventFromText(text: string): string | null {
  const lines = text.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 5)

  // Palavras que indicam que a linha é um evento de rastreamento
  const TRACKING_KEYWORDS = [
    'ENTREGUE', 'ENTREGA', 'TRANSITO', 'SAIDA', 'CHEGADA',
    'RECEBIDO', 'EXPEDIDO', 'COLETADO', 'DISTRIBUICAO', 'AGUARDANDO',
    'TRANSFERENCIA', 'DEVOLV', 'RETORNO', 'CANCELAD',
  ]

  // Palavras que indicam UI / navegação (não são eventos)
  const UI_SKIP = [
    'rastrear', 'pesquisar', 'buscar', 'consultar', 'cnpj', 'nota fiscal',
    'captcha', 'código', 'enviar', 'limpar', 'resultado', 'copyright',
    'fale conosco', 'home', 'portal',
  ]

  let lastEvent: string | null = null

  for (const line of lines) {
    const normalized = line.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const lower = line.toLowerCase()

    if (UI_SKIP.some((s) => lower.includes(s))) continue
    if (TRACKING_KEYWORDS.some((kw) => normalized.includes(kw))) {
      lastEvent = line
    }
  }

  return lastEvent
}
