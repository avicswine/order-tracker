/**
 * Arquivo de remessa CNAB 240 do Sicredi para pagar guias GNRE pelo código de barras.
 *
 * Fonte: manual "Pagamento a Fornecedor – CNAB 240 Febraban", Banco Cooperativo Sicredi, v1.5 (07/2026),
 * enviado pelo José (Downloads/media_produtos_filer_public_2026_07_17_pagamento-a-fornecedores-layout-cnab-240-v15_3.pdf).
 * Pagamento de tributo com código de barras = tipo de serviço 22, forma de lançamento 11, segmento O (pág. 12 e 16).
 *
 * O arquivo só AGENDA: quem paga é o José, aprovando no Internet Banking do Sicredi.
 * Aqui só se monta o texto; sem banco de dados, sem rede.
 */

/** registro do CNAB: sempre 240 posições (manual, "Tamanho do registro") */
const TAMANHO_REGISTRO = 240
const CODIGO_SICREDI = '748'
const TIPO_SERVICO_TRIBUTOS = '22'
const FORMA_CODIGO_DE_BARRAS = '11'
/** "livre desde que tenha 3 dígitos" (header de arquivo e de lote) */
const VERSAO_LAYOUT = '082'
const VERSAO_LOTE = '040'

export interface ContaSicredi {
  cnpj: string
  razaoSocial: string
  /** código do convênio (4 caracteres, ex.: 7SR1) — informado pela gerente em 24/11/2026 */
  convenio: string
  agencia: string
  agenciaDv: string
  conta: string
  contaDv: string
}

export interface PagamentoTributo {
  /** código de barras de 44 dígitos (não a linha digitável) */
  codigoBarras: string
  /** nome do órgão (ex.: "GNRE AL") */
  orgao: string
  /** AAAA-MM-DD */
  vencimento: string
  /** AAAA-MM-DD — o dia em que o banco debita */
  dataPagamento: string
  valor: number
  /** número do documento do cliente (vem de volta no retorno): o número da NF */
  seuNumero: string
}

/** número: à direita, zeros à esquerda (manual, "Alinhamento dos campos") */
function num(valor: string | number, tamanho: number): string {
  const s = String(valor).replace(/\D/g, '')
  if (s.length > tamanho) throw new Error(`campo numérico maior que ${tamanho} posições`)
  return s.padStart(tamanho, '0')
}

/** texto: à esquerda, brancos à direita; sem acento nem caractere fora do ASCII (manual v2.2/2.4) */
function alfa(valor: string, tamanho: number): string {
  const s = valor.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,/-]/g, ' ').toUpperCase()
  return s.slice(0, tamanho).padEnd(tamanho, ' ')
}

const brancos = (tamanho: number) => ' '.repeat(tamanho)

/** AAAA-MM-DD → DDMMAAAA */
function ddmmaaaa(iso: string): string {
  const [a, m, d] = iso.split('-')
  if (!a || !m || !d) throw new Error(`data inválida: "${iso}"`)
  return `${d}${m}${a}`
}

/**
 * Valor gravado no código de barras de arrecadação (começa com 8): quando o 3º dígito é 6 ou 7,
 * as posições 5 a 15 são o valor em centavos (padrão Febraban de arrecadação). Senão, null.
 */
export function valorDoCodigoDeBarras(codigo: string): number | null {
  if (codigo[0] !== '8' || !['6', '7'].includes(codigo[2])) return null
  return Number(codigo.slice(4, 15))
}

/** valor em reais → centavos, sem vírgula (formato 9(n)V2) */
const centavos = (valor: number) => Math.round(valor * 100)

function registro(partes: string[]): string {
  const linha = partes.join('')
  if (linha.length !== TAMANHO_REGISTRO) throw new Error(`registro com ${linha.length} posições (esperado ${TAMANHO_REGISTRO})`)
  return linha
}

/** os campos de empresa e conta, iguais no header de arquivo e no de lote (posições 018 a 102) */
function empresaEConta(c: ContaSicredi): string {
  return '2' + num(c.cnpj, 14) + alfa(c.convenio, 4) + brancos(16)
    + num(c.agencia, 5) + alfa(c.agenciaDv, 1) + num(c.conta, 12) + alfa(c.contaDv, 1) + brancos(1)
    + alfa(c.razaoSocial, 30)
}

/**
 * Monta a remessa: header de arquivo, um lote de tributos com um segmento O por guia, trailers.
 * Linhas separadas por CR+LF, com CR+LF também depois da última (manual 4.1, "linha finalizadora").
 */
export function montarRemessaTributos(conta: ContaSicredi, sequencial: number, geradoEm: Date, pagamentos: PagamentoTributo[]): string {
  if (!pagamentos.length) throw new Error('nenhuma guia para o arquivo')
  if (conta.convenio.length !== 4) throw new Error(`código do convênio deve ter 4 caracteres (veio "${conta.convenio}")`)
  const lote = '0001'
  // data e hora de geração no horário de Brasília
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(geradoEm)
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? '00'
  const dataGeracao = `${p('day')}${p('month')}${p('year')}`
  const horaGeracao = `${p('hour')}${p('minute')}${p('second')}`.replace(/^24/, '00')

  const headerArquivo = registro([
    CODIGO_SICREDI, '0000', '0', brancos(9), empresaEConta(conta),
    alfa('SICREDI', 30), brancos(10), '1', dataGeracao, horaGeracao, num(sequencial, 6), VERSAO_LAYOUT, num(0, 5),
    brancos(20), brancos(20), brancos(29),
  ])
  const headerLote = registro([
    CODIGO_SICREDI, lote, '1', 'C', TIPO_SERVICO_TRIBUTOS, FORMA_CODIGO_DE_BARRAS, VERSAO_LOTE, brancos(1), empresaEConta(conta),
    brancos(40), brancos(30), num(0, 5), brancos(15), brancos(20), num(0, 5), num(0, 3), brancos(2), brancos(8), brancos(10),
  ])
  const detalhes = pagamentos.map((g, i) => {
    if (!/^\d{44}$/.test(g.codigoBarras)) throw new Error(`${g.seuNumero}: código de barras deve ter 44 dígitos`)
    const valorNoCodigo = valorDoCodigoDeBarras(g.codigoBarras)
    if (valorNoCodigo !== null && valorNoCodigo !== centavos(g.valor)) {
      throw new Error(`${g.seuNumero}: o valor no código de barras não bate com o valor da guia`)
    }
    if (!(g.valor > 0)) throw new Error(`NF ${g.seuNumero}: valor inválido`)
    return registro([
      CODIGO_SICREDI, lote, '3', num(i + 1, 5), 'O', '0', '00', g.codigoBarras, alfa(g.orgao, 30),
      ddmmaaaa(g.vencimento), ddmmaaaa(g.dataPagamento), num(centavos(g.valor), 15), alfa(g.seuNumero, 20), brancos(20), brancos(68), brancos(10),
    ])
  })
  const total = pagamentos.reduce((s, g) => s + centavos(g.valor), 0)
  const trailerLote = registro([
    CODIGO_SICREDI, lote, '5', brancos(9), num(detalhes.length + 2, 6), num(total, 18), num(0, 18), brancos(6), brancos(165), brancos(10),
  ])
  const linhas = [headerArquivo, headerLote, ...detalhes, trailerLote]
  const trailerArquivo = registro([
    CODIGO_SICREDI, '9999', '9', brancos(9), num(1, 6), num(linhas.length + 1, 6), num(0, 6), brancos(205),
  ])
  return [...linhas, trailerArquivo].join('\r\n') + '\r\n'
}

/**
 * Nome do arquivo para convênio de 4 caracteres: CCCCDDSS.REM (manual 4.5) — DD = dia do mês,
 * SS = quantos arquivos daquela empresa já foram gerados no mesmo dia (00 no primeiro).
 */
export function nomeArquivoRemessa(convenio: string, dia: number, jaGeradosHoje: number): string {
  return `${convenio}${String(dia).padStart(2, '0')}${String(jaGeradosHoje).padStart(2, '0')}.REM`
}
