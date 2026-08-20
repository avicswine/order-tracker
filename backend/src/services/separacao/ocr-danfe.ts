import { createWorker, type Worker } from 'tesseract.js'
import { parsearChaveDanfe } from './danfe'

// Lê a foto de uma etiqueta DANFE e extrai a chave de acesso (44 dígitos) ou o número da NF.
// Usado quando a câmera não consegue decodificar o código de barras (Code128 de 44 dígitos é denso):
// o operador fotografa a etiqueta e o servidor lê os números impressos.

export interface ResultadoOcrDanfe {
  chave: string | null
  numero: string | null
  serie: string | null
  texto: string
}

// Reaproveita o worker entre chamadas (subir um novo custa ~2 s)
let workerPromise: Promise<Worker> | null = null
let timerOcioso: NodeJS.Timeout | null = null
const OCIOSO_MS = 5 * 60 * 1000

async function obterWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('eng').then(async w => {
      // Só dígitos e os separadores que aparecem na etiqueta — melhora muito a precisão
      await w.setParameters({ tessedit_char_whitelist: '0123456789 |/.-:' })
      return w
    })
  }
  if (timerOcioso) clearTimeout(timerOcioso)
  timerOcioso = setTimeout(() => { encerrarWorker().catch(() => undefined) }, OCIOSO_MS)
  return workerPromise
}

export async function encerrarWorker() {
  const p = workerPromise
  workerPromise = null
  if (timerOcioso) { clearTimeout(timerOcioso); timerOcioso = null }
  if (p) await (await p).terminate()
}

// A chave costuma sair com espaços a cada 4 dígitos ("4326 0854 ..."); a etiqueta também traz
// o protocolo (15 dígitos) e o número da NF ("Nº NFe: 005092").
function extrairDados(texto: string): Omit<ResultadoOcrDanfe, 'texto'> {
  const soDigitos = texto.replace(/[^\d]/g, '')

  // 1) Chave: procura qualquer sequência de 44 dígitos no texto sem separadores
  let chave: string | null = null
  for (let i = 0; i + 44 <= soDigitos.length; i++) {
    const candidata = soDigitos.slice(i, i + 44)
    const parse = parsearChaveDanfe(candidata)
    // Valida o formato: modelo 55 (NF-e) ou 65 (NFC-e) na posição certa
    const modelo = candidata.slice(20, 22)
    if (parse && (modelo === '55' || modelo === '65')) { chave = candidata; break }
  }
  if (chave) {
    const p = parsearChaveDanfe(chave)!
    return { chave, numero: p.numero, serie: p.serie }
  }

  // 2) Número da NF pelo rótulo ("NFe: 005092", "N NFe 5092", "NF-e: 5092")
  const rotulo = texto.match(/N[FfEe°ºo\W]{0,6}(?:NFe|NF-e|NFE)?[\s:.\-]*?(\d{3,9})/i)
  if (rotulo) {
    const numero = String(parseInt(rotulo[1], 10))
    const serieMatch = texto.match(/S[EÉ]RIE[\s:.\-]*(\d{1,3})/i)
    return { chave: null, numero, serie: serieMatch ? String(parseInt(serieMatch[1], 10)) : null }
  }

  return { chave: null, numero: null, serie: null }
}

export async function lerDanfeDaImagem(imagem: Buffer): Promise<ResultadoOcrDanfe> {
  const worker = await obterWorker()
  const { data } = await worker.recognize(imagem)
  const texto = data.text || ''
  return { ...extrairDados(texto), texto: texto.slice(0, 500) }
}

// Aceita data URL ("data:image/jpeg;base64,...") ou base64 puro
export function imagemDeBase64(entrada: string): Buffer | null {
  const base64 = entrada.includes(',') ? entrada.slice(entrada.indexOf(',') + 1) : entrada
  try {
    const buf = Buffer.from(base64, 'base64')
    return buf.length > 1000 ? buf : null
  } catch {
    return null
  }
}
