/**
 * Lê o grupo de DIFAL (ICMSUFDest) do XML da nota.
 *
 * O XML é a fonte mais confiável que temos: diz qual alíquota interna do destino
 * e qual redução de base o emissor de fato usou, em vez de dependermos só da
 * nossa tabela. O grupo só existe quando o destinatário é consumidor final não
 * contribuinte — que é exatamente quando há DIFAL a recolher.
 *
 * Observação: o valor (vICMSUFDest) vem zerado nas notas do Mercado Livre, porque
 * o imposto é recolhido depois, por guia. O que aproveitamos aqui são as
 * alíquotas e a redução declaradas.
 */

export interface DifalDoXml {
  temGrupoDifal: boolean
  /** alíquota interna do estado de destino, como a nota declarou */
  aliquotaDestino: number | null
  /** alíquota interestadual usada (7% ou 12%) */
  aliquotaInterestadual: number | null
  /** percentual do fundo de combate à pobreza no destino */
  fcpDestino: number | null
  /** redução de base aplicada na origem (41,43% ou 41,67% nos produtos do Anexo II) */
  reducaoBaseOrigem: number | null
  /** alíquota de ICMS destacada na origem */
  aliquotaOrigem: number | null
  /** valor do DIFAL declarado na nota (zero quando é recolhido por guia) */
  valorDeclarado: number | null
}

function numero(xml: string, tag: string): number | null {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  if (!m) return null
  const v = Number(m[1])
  return Number.isFinite(v) ? v : null
}

export function lerDifalDoXml(xml: string): DifalDoXml {
  const grupo = xml.match(/<ICMSUFDest>([\s\S]*?)<\/ICMSUFDest>/)
  const dentro = grupo?.[1] ?? ''
  return {
    temGrupoDifal: Boolean(grupo),
    aliquotaDestino: dentro ? numero(dentro, 'pICMSUFDest') : null,
    aliquotaInterestadual: dentro ? numero(dentro, 'pICMSInter') : null,
    fcpDestino: dentro ? numero(dentro, 'pFCPUFDest') : null,
    valorDeclarado: dentro ? numero(dentro, 'vICMSUFDest') : null,
    // estes ficam fora do grupo, no ICMS do item
    reducaoBaseOrigem: numero(xml, 'pRedBC'),
    aliquotaOrigem: numero(xml, 'pICMS'),
  }
}

/**
 * A alíquota que o XML declara bate com a que temos cadastrada?
 * Divergência aqui costuma significar tabela desatualizada do nosso lado.
 */
export function conferirComCadastro(
  doXml: DifalDoXml,
  cadastrada: { aliquotaInterna: number; interestadual: number }
): { confere: boolean; avisos: string[] } {
  const avisos: string[] = []
  if (!doXml.temGrupoDifal) return { confere: true, avisos }

  if (doXml.aliquotaDestino != null && Math.abs(doXml.aliquotaDestino - cadastrada.aliquotaInterna) > 0.01) {
    avisos.push(
      `a nota declara alíquota interna de ${doXml.aliquotaDestino}% e temos ${cadastrada.aliquotaInterna}% cadastrados`
    )
  }
  if (
    doXml.aliquotaInterestadual != null &&
    Math.abs(doXml.aliquotaInterestadual - cadastrada.interestadual) > 0.01
  ) {
    avisos.push(
      `a nota declara interestadual de ${doXml.aliquotaInterestadual}% e temos ${cadastrada.interestadual}%`
    )
  }
  return { confere: avisos.length === 0, avisos }
}
