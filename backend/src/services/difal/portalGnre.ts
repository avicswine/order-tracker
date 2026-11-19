/**
 * Cliente dos webservices do Portal GNRE (Manual de Integração v2.17, itens 3.4 e 4).
 *
 * Três serviços, todos SOAP 1.2 (Document/Literal) com autenticação mútua TLS pelo
 * certificado e-CNPJ A1 da empresa:
 *   - GnreConfigUF        (síncrono)  → códigos de receita e exigências de cada UF
 *   - GnreLoteRecepcao    (assíncrono)→ envia o lote; devolve um recibo
 *   - GnreResultadoLote   (síncrono)  → busca o resultado do recibo (guias, código de barras, PDF)
 *
 * Padrão da mensagem (manual 3.4.1):
 *   SOAP Header: <gnreCabecMsg xmlns="…/webservice/<Serviço>"><versaoDados>…</versaoDados></gnreCabecMsg>
 *   SOAP Body:   <gnreDadosMsg> com a área de dados; a resposta vem em <gnreRespostaMsg>.
 *   Cabeçalho HTTP SOAPAction = namespace/operação (consultar | processar).
 *   Tudo conferido nos WSDL de homologação (scratchpad/gnre/wsdl) em 19/11/2026.
 *
 * Certificado e ambiente vêm de variáveis de ambiente, nunca do código:
 *   GNRE_AMBIENTE            homologacao (padrão) | producao
 *   GNRE_PFX_ARQUIVO_<EMP>   caminho do arquivo .pfx no PC (EMP = AVIC | AGRO), ou
 *   GNRE_PFX_BASE64_<EMP>    o mesmo arquivo em base64 (para o Railway)
 *   GNRE_PFX_SENHA_<EMP>     senha do .pfx
 *
 * Limite do portal: 500 requisições/minuto por IP; 429 vem com Retry-After (manual 3.2.2).
 * Nenhuma chamada aqui movimenta dinheiro: gerar a guia não é pagar a guia.
 */
import https from 'https'
import { existsSync, readFileSync } from 'fs'
import axios, { AxiosError } from 'axios'
import { escapar } from './gnre'

export type AmbienteGnre = 'homologacao' | 'producao'
export type EmpresaGnre = 'AVIC' | 'AGRO'

const HOST: Record<AmbienteGnre, string> = {
  homologacao: 'https://www.testegnre.pe.gov.br',
  producao: 'https://www.gnre.pe.gov.br',
}
/** código do ambiente dentro dos XML (manual: 1 produção, 2 homologação) */
const CODIGO_AMBIENTE: Record<AmbienteGnre, '1' | '2'> = { producao: '1', homologacao: '2' }

// namespace e operações conferidos nos WSDL de homologação em 19/11/2026
const NS_WEBSERVICE = 'http://www.gnre.pe.gov.br/webservice/'
const NS_DADOS = 'http://www.gnre.pe.gov.br'

const SERVICO = {
  configUf: { caminho: 'GnreConfigUF', operacao: 'consultar', versaoDados: '1.00' },
  loteRecepcao: { caminho: 'GnreLoteRecepcao', operacao: 'processar', versaoDados: '2.00' },
  resultadoLote: { caminho: 'GnreResultadoLote', operacao: 'consultar', versaoDados: '1.00' },
} as const

export function soapAction(servico: NomeServico): string {
  const { caminho, operacao } = SERVICO[servico]
  return `${NS_WEBSERVICE}${caminho}/${operacao}`
}
type NomeServico = keyof typeof SERVICO

const TENTATIVAS_429 = 3
const ESPERA_PADRAO_429_MS = 2000

export class ErroPortalGnre extends Error {}

// ------------------------------------------------------------------ configuração

export function ambienteGnre(): AmbienteGnre {
  return process.env.GNRE_AMBIENTE === 'producao' ? 'producao' : 'homologacao'
}

/**
 * O .pfx pode vir de duas formas: caminho do arquivo (GNRE_PFX_ARQUIVO_<EMP>, prático no PC)
 * ou conteúdo em base64 (GNRE_PFX_BASE64_<EMP>, para o Railway, que não tem o arquivo).
 */
function certificado(empresa: EmpresaGnre): { pfx: Buffer; passphrase: string } | null {
  const senha = process.env[`GNRE_PFX_SENHA_${empresa}`]
  if (!senha) return null
  const arquivo = process.env[`GNRE_PFX_ARQUIVO_${empresa}`]
  if (arquivo) {
    if (!existsSync(arquivo)) return null
    return { pfx: readFileSync(arquivo), passphrase: senha }
  }
  const b64 = process.env[`GNRE_PFX_BASE64_${empresa}`]
  if (!b64) return null
  return { pfx: Buffer.from(b64, 'base64'), passphrase: senha }
}

export function portalConfigurado(empresa: EmpresaGnre): boolean {
  return certificado(empresa) !== null
}

export function statusPortal() {
  return {
    ambiente: ambienteGnre(),
    host: HOST[ambienteGnre()],
    empresas: { AVIC: portalConfigurado('AVIC'), AGRO: portalConfigurado('AGRO') },
  }
}

// ------------------------------------------------------------------ utilidades XML

function desescapar(v: string): string {
  return v
    // entidades numéricas (&#xE7; = ç) — o portal devolve os acentos assim
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

/** texto do primeiro elemento <tag>…</tag> (ignora prefixo de namespace e atributos) */
export function texto(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`).exec(xml)
  return m ? desescapar(m[1].trim()) : undefined
}

/** todos os blocos <tag>…</tag>, com o conteúdo interno e os atributos da abertura */
export function blocos(xml: string, tag: string): { atributos: Record<string, string>; conteudo: string }[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}(\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, 'g')
  const saida: { atributos: Record<string, string>; conteudo: string }[] = []
  for (const m of xml.matchAll(re)) {
    const atributos: Record<string, string> = {}
    for (const a of (m[1] ?? '').matchAll(/([\w:-]+)="([^"]*)"/g)) atributos[a[1]] = desescapar(a[2])
    saida.push({ atributos, conteudo: m[2] })
  }
  return saida
}

function simNao(v: string | undefined): boolean {
  return (v ?? '').trim().toUpperCase() === 'S'
}

// ------------------------------------------------------------------ chamada SOAP

export function montarEnvelope(servico: NomeServico, dadosXml: string): string {
  const { caminho, versaoDados } = SERVICO[servico]
  const ns = NS_WEBSERVICE + caminho
  const dados = dadosXml.replace(/^<\?xml[^>]*\?>\s*/, '')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">\n` +
    `  <soap12:Header>\n` +
    `    <gnreCabecMsg xmlns="${ns}">\n` +
    `      <versaoDados>${versaoDados}</versaoDados>\n` +
    `    </gnreCabecMsg>\n` +
    `  </soap12:Header>\n` +
    `  <soap12:Body>\n` +
    `    <gnreDadosMsg xmlns="${ns}">${dados}</gnreDadosMsg>\n` +
    `  </soap12:Body>\n` +
    `</soap12:Envelope>`
  )
}

/** Tira a área de retorno (gnreRetornoMsg) de dentro do envelope SOAP da resposta. */
export function extrairRetorno(envelopeResposta: string): string {
  const falha = texto(envelopeResposta, 'Fault')
  if (falha) {
    const motivo = texto(falha, 'Text') ?? texto(falha, 'faultstring') ?? falha.slice(0, 200)
    throw new ErroPortalGnre(`o portal devolveu uma falha SOAP: ${motivo}`)
  }
  // o WSDL chama a resposta de gnreRespostaMsg; o manual, de gnreRetornoMsg — aceita os dois
  const retorno = texto(envelopeResposta, 'gnreRespostaMsg') ?? texto(envelopeResposta, 'gnreRetornoMsg')
  if (retorno === undefined) throw new ErroPortalGnre('resposta do portal sem gnreRespostaMsg')
  // pode vir como XML escapado, em CDATA ou aninhado; os três acabam como XML puro aqui
  return retorno.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim()
}

async function chamar(empresa: EmpresaGnre, servico: NomeServico, dadosXml: string): Promise<string> {
  const cert = certificado(empresa)
  if (!cert) throw new ErroPortalGnre(`certificado digital da ${empresa} não configurado (GNRE_PFX_ARQUIVO_${empresa} ou GNRE_PFX_BASE64_${empresa}, mais GNRE_PFX_SENHA_${empresa})`)

  const agent = new https.Agent({ pfx: cert.pfx, passphrase: cert.passphrase, keepAlive: false })
  const url = `${HOST[ambienteGnre()]}/gnreWS/services/${SERVICO[servico].caminho}`
  const envelope = montarEnvelope(servico, dadosXml)

  for (let tentativa = 0; ; tentativa++) {
    try {
      const { data } = await axios.post<string>(url, envelope, {
        httpsAgent: agent,
        // o servidor exige o SOAPAction (respondeu "no SOAPAction header!" sem ele)
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${soapAction(servico)}"`,
          SOAPAction: soapAction(servico),
        },
        responseType: 'text',
        timeout: 60000,
      })
      return extrairRetorno(String(data))
    } catch (e) {
      const erro = e as AxiosError
      const status = erro.response?.status
      if (status === 429 && tentativa < TENTATIVAS_429) {
        const retryAfter = Number(erro.response?.headers?.['retry-after'])
        await new Promise((r) => setTimeout(r, retryAfter > 0 ? retryAfter * 1000 : ESPERA_PADRAO_429_MS * (tentativa + 1)))
        continue
      }
      if (e instanceof ErroPortalGnre) throw e
      if (status) {
        const corpo = typeof erro.response?.data === 'string' ? erro.response.data : ''
        const motivo = texto(corpo, 'Text') ?? texto(corpo, 'faultstring')
        throw new ErroPortalGnre(`portal GNRE respondeu HTTP ${status}${motivo ? ': ' + motivo : ''}`)
      }
      // erro de TLS/certificado aparece aqui (ex.: senha do .pfx errada, certificado não habilitado)
      throw new ErroPortalGnre(`não foi possível falar com o portal GNRE: ${erro.code ?? erro.message}`)
    }
  }
}

// ------------------------------------------------------------------ GnreConfigUF

export interface ReceitaUf {
  codigo: string
  descricao: string
  courier: boolean
  exigeDetalhamentoReceita: boolean
  exigeProduto: boolean
  exigePeriodoReferencia: boolean
  exigeDocumentoOrigem: boolean
  exigeDataVencimento: boolean
  exigeContribuinteDestinatario: string
  exigeCamposAdicionais: boolean
  tiposDocumentosOrigem: { codigo: string; descricao: string }[]
  camposAdicionais: { codigo: string; titulo: string; obrigatorio: boolean; tipo: string }[]
}

export interface ConfigUf {
  uf: string
  situacao: { codigo: string; descricao: string }
  receitas: ReceitaUf[]
  limites: { guiasPorLote?: string; itensPorGuia?: string; itensPorLote?: string }
  bruto: string
}

export function lerConfigUf(xml: string): ConfigUf {
  const receitas: ReceitaUf[] = blocos(xml, 'receita').map(({ atributos, conteudo }) => ({
    codigo: atributos.codigo ?? '',
    descricao: atributos.descricao ?? '',
    courier: simNao(atributos.courier),
    exigeDetalhamentoReceita: simNao(texto(conteudo, 'exigeDetalhamentoReceita')),
    exigeProduto: simNao(texto(conteudo, 'exigeProduto')),
    exigePeriodoReferencia: simNao(texto(conteudo, 'exigePeriodoReferencia')),
    exigeDocumentoOrigem: simNao(texto(conteudo, 'exigeDocumentoOrigem')),
    exigeDataVencimento: simNao(texto(conteudo, 'exigeDataVencimento')),
    exigeContribuinteDestinatario: texto(conteudo, 'exigeContribuinteDestinatario') ?? '',
    exigeCamposAdicionais: simNao(texto(conteudo, 'exigeCamposAdicionais')),
    tiposDocumentosOrigem: blocos(conteudo, 'tipoDocumentoOrigem').map((b) => ({
      codigo: texto(b.conteudo, 'codigo') ?? '',
      descricao: texto(b.conteudo, 'descricao') ?? '',
    })),
    camposAdicionais: blocos(conteudo, 'campoAdicional').map((b) => ({
      codigo: texto(b.conteudo, 'codigo') ?? '',
      titulo: texto(b.conteudo, 'titulo') ?? '',
      obrigatorio: simNao(texto(b.conteudo, 'obrigatorio')),
      tipo: texto(b.conteudo, 'tipo') ?? '',
    })),
  }))
  const qtd = texto(xml, 'qtdMaximas') ?? ''
  return {
    uf: texto(xml, 'uf') ?? '',
    situacao: { codigo: texto(xml, 'codigo') ?? '', descricao: texto(xml, 'descricao') ?? '' },
    receitas,
    limites: {
      guiasPorLote: texto(qtd, 'guiasPorLote'),
      itensPorGuia: texto(qtd, 'itensPorGuia'),
      itensPorLote: texto(qtd, 'itensPorLote'),
    },
    bruto: xml,
  }
}

export async function consultarConfigUf(empresa: EmpresaGnre, uf: string): Promise<ConfigUf> {
  if (!/^[A-Z]{2}$/.test(uf)) throw new ErroPortalGnre('UF inválida')
  const dados =
    `<TConsultaConfigUf xmlns="${NS_DADOS}">` +
    `<ambiente>${CODIGO_AMBIENTE[ambienteGnre()]}</ambiente>` +
    `<uf>${uf}</uf>` +
    `</TConsultaConfigUf>`
  return lerConfigUf(await chamar(empresa, 'configUf', dados))
}

// ------------------------------------------------------------------ GnreLoteRecepcao

export interface ReciboLote {
  situacao: { codigo: string; descricao: string }
  recibo?: { numero: string; dataHora: string; tempoEstimadoMs: number }
  bruto: string
}

export function lerRecibo(xml: string): ReciboLote {
  const sit = texto(xml, 'situacaoRecepcao') ?? ''
  const rec = texto(xml, 'recibo')
  return {
    situacao: { codigo: texto(sit, 'codigo') ?? '', descricao: texto(sit, 'descricao') ?? '' },
    recibo: rec
      ? {
          numero: texto(rec, 'numero') ?? '',
          dataHora: texto(rec, 'dataHoraRecibo') ?? '',
          tempoEstimadoMs: Number(texto(rec, 'tempoEstimadoProc') ?? 0),
        }
      : undefined,
    bruto: xml,
  }
}

export async function enviarLote(empresa: EmpresaGnre, xmlLote: string): Promise<ReciboLote> {
  return lerRecibo(await chamar(empresa, 'loteRecepcao', xmlLote))
}

// ------------------------------------------------------------------ GnreResultadoLote

/** situacaoGuia (manual 4.2.2): 0 sucesso, 1 invalidada pelo portal, 2 invalidada pela UF, 3 erro de comunicação, 4 pendente */
export const SITUACAO_GUIA: Record<string, string> = {
  '0': 'Processada com sucesso',
  '1': 'Invalidada pelo Portal',
  '2': 'Invalidada pela UF',
  '3': 'Erro de comunicação',
  '4': 'Pendência de processamento',
}

export interface GuiaResultado {
  situacaoGuia: string
  situacaoTexto: string
  identificadorGuia?: string
  documentoOrigem?: string
  ufFavorecida?: string
  valorGNRE?: string
  linhaDigitavel?: string
  codigoBarras?: string
  qrcodePayload?: string
  dataLimitePagamento?: string
  nossoNumero?: string
  motivos: { codigo: string; descricao: string; campo?: string }[]
}

export interface ResultadoLote {
  situacao: { codigo: string; descricao: string }
  numeroRecibo?: string
  guias: GuiaResultado[]
  pdfGuias?: string
  bruto: string
}

export function lerResultadoLote(xml: string): ResultadoLote {
  const sit = texto(xml, 'situacaoProcess') ?? ''
  const guias: GuiaResultado[] = blocos(xml, 'guia').map(({ conteudo }) => {
    const situacaoGuia = texto(conteudo, 'situacaoGuia') ?? ''
    return {
      situacaoGuia,
      situacaoTexto: SITUACAO_GUIA[situacaoGuia] ?? `situação ${situacaoGuia}`,
      identificadorGuia: texto(conteudo, 'identificadorGuia'),
      documentoOrigem: texto(conteudo, 'documentoOrigem'),
      ufFavorecida: texto(conteudo, 'ufFavorecida'),
      valorGNRE: texto(conteudo, 'valorGNRE'),
      linhaDigitavel: texto(conteudo, 'linhaDigitavel'),
      codigoBarras: texto(conteudo, 'codigoBarras'),
      qrcodePayload: texto(conteudo, 'qrcodePayload'),
      dataLimitePagamento: texto(conteudo, 'dataLimitePagamento'),
      nossoNumero: texto(conteudo, 'nossoNumero'),
      motivos: blocos(conteudo, 'motivo').map((m) => ({
        codigo: texto(m.conteudo, 'codigo') ?? '',
        descricao: texto(m.conteudo, 'descricao') ?? '',
        campo: texto(m.conteudo, 'campo'),
      })),
    }
  })
  return {
    situacao: { codigo: texto(sit, 'codigo') ?? '', descricao: texto(sit, 'descricao') ?? '' },
    numeroRecibo: texto(xml, 'numeroRecibo'),
    guias,
    pdfGuias: texto(xml, 'pdfGuias'),
    bruto: xml,
  }
}

export async function consultarResultadoLote(
  empresa: EmpresaGnre,
  numeroRecibo: string,
  incluirPdf = true
): Promise<ResultadoLote> {
  if (!/^\d{10}(\d{4})?$/.test(numeroRecibo)) throw new ErroPortalGnre('número de recibo inválido (10 ou 14 dígitos)')
  const dados =
    `<TConsLote_GNRE xmlns="${NS_DADOS}">` +
    `<ambiente>${CODIGO_AMBIENTE[ambienteGnre()]}</ambiente>` +
    `<numeroRecibo>${escapar(numeroRecibo)}</numeroRecibo>` +
    (incluirPdf ? `<incluirPDFGuias>S</incluirPDFGuias>` : '') +
    `</TConsLote_GNRE>`
  return lerResultadoLote(await chamar(empresa, 'resultadoLote', dados))
}
