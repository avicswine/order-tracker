/**
 * Monta o XML de lote da GNRE (Guia Nacional de Recolhimento de Tributos Estaduais).
 *
 * Segue o Manual de Integração do Contribuinte com o GNRE, versão 2.17 (03/09/2026),
 * no layout 2.00 dos schemas `lote_gnre_v2.00.xsd` e `dados_gnre_v2.00.xsd`.
 *
 * O lote vai para o webservice GnreLoteRecepcao, que devolve um recibo; as guias
 * prontas são buscadas depois no GnreResultadoLote. Os dois exigem HTTPS com o
 * certificado digital e-CNPJ da empresa e habilitação prévia no portal. Esta parte
 * só monta o documento — não envia nada.
 *
 * Regras tiradas do XSD, que valem mais que qualquer suposição:
 *   - município é o código IBGE de 5 dígitos (sem os 2 da UF)  [TCodMunIBGE]
 *   - datas em AAAA-MM-DD                                       [TData]
 *   - valores com ponto e duas casas, ex.: "15.00"               [TDec_1502]
 *   - CNPJ com 14 dígitos, CPF com 11, IE de 2 a 16             [TCnpj/TCpf/TIe]
 *   - no máximo 50 guias por lote, 100 itens por guia           [manual, item 3]
 *
 * O código da receita NÃO é fixo: cada UF publica o seu no serviço GnreConfigUF, e
 * é de lá que ele deve vir (fica guardado na tabela de alíquotas).
 */

/** Tipos de valor do item (manual: 11 principal ICMS, 12 principal FP, 31 multa, 41 juros, 51 atualização). */
export const TIPO_VALOR = {
  principalIcms: '11',
  principalFundoPobreza: '12',
  totalIcms: '21',
  totalFundoPobreza: '22',
  multaIcms: '31',
  multaFundoPobreza: '32',
  jurosIcms: '41',
  jurosFundoPobreza: '42',
} as const

/** Tipo da guia: 0 simples, 1 múltiplos documentos de origem, 2 múltiplas receitas. */
export const TIPO_GNRE = { simples: '0', multiplosDocumentos: '1', multiplasReceitas: '2' } as const

/** Tipo do documento de origem mais comum para nós: 10 = NF-e. Confirmar por UF no GnreConfigUF. */
export const DOC_ORIGEM_NFE = '10'

export const LIMITE_GUIAS_POR_LOTE = 50
export const LIMITE_ITENS_POR_GUIA = 100

export interface EmitenteGnre {
  cnpj: string
  inscricaoEstadual?: string
  razaoSocial: string
  endereco: string
  /** código IBGE do município com 5 dígitos (sem a UF) */
  municipio: string
  uf: string
  cep: string
  telefone?: string
}

export interface DestinatarioGnre {
  /** CNPJ ou CPF, só dígitos */
  documento: string
  razaoSocial: string
  /** código IBGE do município com 5 dígitos (sem a UF) */
  municipio: string
}

export interface GuiaGnre {
  /** UF que recebe o imposto */
  ufFavorecida: string
  /** código da receita, conforme o GnreConfigUF da UF */
  receita: string
  detalhamentoReceita?: string
  /** número da nota que originou o recolhimento */
  documentoOrigem: string
  tipoDocumentoOrigem?: string
  /** AAAA-MM-DD */
  dataVencimento: string
  /** valor principal do ICMS, em reais */
  valorPrincipal: number
  /** fundo de combate à pobreza, quando a UF cobrar junto */
  valorFundoPobreza?: number
  referencia?: { periodo?: string; mes: string; ano: string; parcela?: string }
  destinatario: DestinatarioGnre
  /** exigências extras da UF, vindas do GnreConfigUF (no máximo 3) */
  camposExtras?: { codigo: string; valor: string }[]
  /** AAAA-MM-DD; várias UFs exigem (exigeDataPagamento no GnreConfigUF). Deve ser >= hoje e <= vencimento */
  dataPagamento?: string
  /** nosso identificador, para casar a resposta com a nota */
  identificadorGuia?: string
}

export class ErroMontagemGnre extends Error {}

/** XSD dados_gnre_v2.00: razaoSocial e endereco têm maxLength 60 */
const TAMANHO_MAX_TEXTO = 60

export function escapar(v: string): string {
  return String(v).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string
  )
}

/**
 * Texto livre (razão social, endereço) no formato TString do XSD: até 60 caracteres, sem espaço
 * nas pontas e só caracteres de U+0020 a U+00FF (latim comum, com acentos). Aspas e travessões
 * tipográficos viram os simples; o que mais estiver fora da faixa sai.
 */
export function textoGnre(v: string | undefined): string | undefined {
  if (v === undefined) return undefined
  const limpo = String(v)
    .normalize('NFC')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\s/g, ' ')
    .replace(/[^\u0020-\u00FF]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, TAMANHO_MAX_TEXTO)
    .trim()
  return limpo || undefined
}

function digitos(v: string | undefined): string {
  return String(v ?? '').replace(/\D/g, '')
}

/** TDec_1502: "0", "0.xx" ou "n.xx" sem zero à esquerda. */
function dinheiro(v: number): string {
  return (Math.round(v * 100) / 100).toFixed(2)
}

function conferir(guias: GuiaGnre[], emitente: EmitenteGnre): void {
  if (!guias.length) throw new ErroMontagemGnre('lote sem nenhuma guia')
  if (guias.length > LIMITE_GUIAS_POR_LOTE) {
    throw new ErroMontagemGnre(
      `o portal aceita no máximo ${LIMITE_GUIAS_POR_LOTE} guias por lote, e vieram ${guias.length}`
    )
  }
  if (digitos(emitente.cnpj).length !== 14) throw new ErroMontagemGnre('CNPJ do emitente inválido')
  if (!/^\d{5}$/.test(emitente.municipio)) {
    throw new ErroMontagemGnre('município do emitente deve ser o código IBGE de 5 dígitos (sem a UF)')
  }
  if (digitos(emitente.cep).length !== 8) throw new ErroMontagemGnre('CEP do emitente deve ter 8 dígitos')

  guias.forEach((g, i) => {
    const onde = `guia ${i + 1} (${g.ufFavorecida}, nota ${g.documentoOrigem})`
    if (!/^[A-Z]{2}$/.test(g.ufFavorecida)) throw new ErroMontagemGnre(`${onde}: UF inválida`)
    if (!g.receita) throw new ErroMontagemGnre(`${onde}: sem código de receita — consulte o GnreConfigUF`)
    if (!(g.valorPrincipal > 0)) throw new ErroMontagemGnre(`${onde}: valor principal deve ser maior que zero`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.dataVencimento)) {
      throw new ErroMontagemGnre(`${onde}: vencimento deve estar em AAAA-MM-DD`)
    }
    const doc = digitos(g.destinatario.documento)
    if (doc.length !== 11 && doc.length !== 14) {
      throw new ErroMontagemGnre(`${onde}: documento do destinatário deve ter 11 (CPF) ou 14 (CNPJ) dígitos`)
    }
    if (!/^\d{5}$/.test(g.destinatario.municipio)) {
      throw new ErroMontagemGnre(`${onde}: município do destinatário deve ser o código IBGE de 5 dígitos`)
    }
    if ((g.camposExtras?.length ?? 0) > 3) throw new ErroMontagemGnre(`${onde}: no máximo 3 campos extras`)
  })
}

function tag(nome: string, valor: string | undefined, recuo: string): string {
  return valor === undefined || valor === '' ? '' : `${recuo}<${nome}>${escapar(valor)}</${nome}>\n`
}

/** Elemento TDadosGNRE no layout 2.00. */
function montarGuia(g: GuiaGnre, emitente: EmitenteGnre): string {
  const doc = digitos(g.destinatario.documento)
  const tipoDoc = doc.length === 14 ? 'CNPJ' : 'CPF'
  const valores =
    `          <valor tipo="${TIPO_VALOR.principalIcms}">${dinheiro(g.valorPrincipal)}</valor>\n` +
    (g.valorFundoPobreza && g.valorFundoPobreza > 0
      ? `          <valor tipo="${TIPO_VALOR.principalFundoPobreza}">${dinheiro(g.valorFundoPobreza)}</valor>\n`
      : '')
  const total = g.valorPrincipal + (g.valorFundoPobreza ?? 0)

  let referencia = ''
  if (g.referencia) {
    referencia =
      '          <referencia>\n' +
      tag('periodo', g.referencia.periodo, '            ') +
      tag('mes', g.referencia.mes, '            ') +
      tag('ano', g.referencia.ano, '            ') +
      tag('parcela', g.referencia.parcela, '            ') +
      '          </referencia>\n'
  }

  let extras = ''
  if (g.camposExtras?.length) {
    extras =
      '          <camposExtras>\n' +
      g.camposExtras
        .map(
          (c) =>
            '            <campoExtra>\n' +
            tag('codigo', c.codigo, '              ') +
            tag('valor', c.valor, '              ') +
            '            </campoExtra>\n'
        )
        .join('') +
      '          </camposExtras>\n'
  }

  return (
    `    <TDadosGNRE versao="2.00">\n` +
    tag('ufFavorecida', g.ufFavorecida, '      ') +
    tag('tipoGnre', TIPO_GNRE.simples, '      ') +
    `      <contribuinteEmitente>\n` +
    `        <identificacao>\n` +
    tag('CNPJ', digitos(emitente.cnpj), '          ') +
    tag('IE', digitos(emitente.inscricaoEstadual) || undefined, '          ') +
    `        </identificacao>\n` +
    tag('razaoSocial', textoGnre(emitente.razaoSocial), '        ') +
    tag('endereco', textoGnre(emitente.endereco), '        ') +
    tag('municipio', emitente.municipio, '        ') +
    tag('uf', emitente.uf, '        ') +
    tag('cep', digitos(emitente.cep), '        ') +
    tag('telefone', digitos(emitente.telefone) || undefined, '        ') +
    `      </contribuinteEmitente>\n` +
    `      <itensGNRE>\n` +
    `        <item>\n` +
    tag('receita', g.receita, '          ') +
    tag('detalhamentoReceita', g.detalhamentoReceita, '          ') +
    `          <documentoOrigem tipo="${escapar(g.tipoDocumentoOrigem ?? DOC_ORIGEM_NFE)}">${escapar(g.documentoOrigem)}</documentoOrigem>\n` +
    referencia +
    tag('dataVencimento', g.dataVencimento, '          ') +
    valores +
    `          <contribuinteDestinatario>\n` +
    `            <identificacao>\n` +
    tag(tipoDoc, doc, '              ') +
    `            </identificacao>\n` +
    tag('razaoSocial', textoGnre(g.destinatario.razaoSocial), '            ') +
    tag('municipio', g.destinatario.municipio, '            ') +
    `          </contribuinteDestinatario>\n` +
    extras +
    `        </item>\n` +
    `      </itensGNRE>\n` +
    tag('valorGNRE', dinheiro(total), '      ') +
    tag('dataPagamento', g.dataPagamento, '      ') +
    tag('identificadorGuia', g.identificadorGuia, '      ') +
    `    </TDadosGNRE>`
  )
}

/** XML completo do lote, pronto para o GnreLoteRecepcao. */
export function montarLoteGnre(guias: GuiaGnre[], emitente: EmitenteGnre): string {
  conferir(guias, emitente)
  const corpo = guias.map((g) => montarGuia(g, emitente)).join('\n')
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<TLote_GNRE xmlns="http://www.gnre.pe.gov.br" versao="2.00">\n` +
    `  <guias>\n${corpo}\n  </guias>\n` +
    `</TLote_GNRE>\n`
  )
}

/** Divide as guias em lotes do tamanho que o portal aceita. */
export function dividirEmLotes<T>(guias: T[], porLote = LIMITE_GUIAS_POR_LOTE): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < guias.length; i += porLote) lotes.push(guias.slice(i, i + porLote))
  return lotes
}
