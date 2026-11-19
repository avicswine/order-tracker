/**
 * Cálculo do DIFAL das notas de saída.
 *
 * Base legal: Convênio ICMS 52/91, Anexo II (máquinas e implementos agrícolas).
 * Para os produtos de NCM 8436 a carga tributária total da operação é de 5,6%.
 * A nota já sai do RS com a base reduzida (58,57%) e ICMS de 7%, o que dá 4,1%
 * recolhidos na origem. Resta 1,5% de DIFAL para o estado de destino:
 *
 *     valor x 58,57% (base reduzida) x 7% (interestadual) = 4,10%  -> origem
 *     carga total devida                                  = 5,60%
 *     DIFAL = 5,60% - 4,10%                               = 1,50%  -> destino
 *
 * Ceará, Mato Grosso e Pernambuco têm posição própria do fisco e usam outro
 * método ("prop"): base reduzida vezes a diferença entre as alíquotas.
 *
 * Confere com a calculadora interna (Calculadora_DIFAL_8436_revisada.html,
 * revisada em 05/11/2026) e com o ICMS destacado nos XML das notas.
 */

/** Carga tributária total do Anexo II do Convênio 52/91, em operação interna. */
export const CARGA_CONVENIO = 5.6

/** Carga já recolhida na origem, conforme a alíquota interestadual do RS. */
const CARGA_ORIGEM: Record<number, number> = { 7: 4.1, 12: 7.0 }

/** NCM com este prefixo tem direito à redução do Anexo II. */
const PREFIXO_COM_REDUCAO = '8436'

export type MetodoDifal = 'carga' | 'prop' | 'sem_reducao' | 'isento'

export type Responsavel = 'ML_PAGA' | 'NOSSO' | 'CLIENTE' | 'SEM_DIFAL'

export interface RegraUf {
  uf: string
  nome: string
  aliquotaInterna: number
  fcp: number
  interestadual: number
  metodo: 'carga' | 'prop'
}

export interface ItemNota {
  ncm: string | null
  valorTotal: number
}

export interface DadosNota {
  ufDestino: string
  ufOrigem?: string
  temInscricaoEstadual: boolean
  canalTipo?: string | null
  itens: ItemNota[]
  valorFrete?: number
}

export interface ResultadoDifal {
  responsavel: Responsavel
  metodo: MetodoDifal
  valorComReducao: number
  valorSemReducao: number
  baseCalculo: number
  difal: number
  detalhe: Record<string, unknown>
}

/** O item tem direito à redução de base do Anexo II? */
export function temReducao(ncm: string | null | undefined): boolean {
  if (!ncm) return false
  return ncm.replace(/\D/g, '').startsWith(PREFIXO_COM_REDUCAO)
}

/** Canais do Bling cujo DIFAL é recolhido pelo próprio Mercado Livre. */
export function mlRecolhe(canalTipo?: string | null): boolean {
  if (!canalTipo) return false
  const t = canalTipo.toLowerCase()
  return t.includes('mercadolivre') || t.includes('mercadoshops')
}

/**
 * Quem responde pelo recolhimento desta nota.
 *
 * Um destinatário com inscrição estadual é contribuinte: o DIFAL é apurado por
 * ele, não por nós. Sem IE, o consumidor é final e o DIFAL é da operação — pago
 * pelo Mercado Livre quando a venda é dele, ou por nós nos demais canais.
 */
export function definirResponsavel(nota: DadosNota): Responsavel {
  const origem = (nota.ufOrigem || 'RS').toUpperCase()
  if (nota.ufDestino?.toUpperCase() === origem) return 'SEM_DIFAL'
  if (nota.temInscricaoEstadual) return 'CLIENTE'
  return mlRecolhe(nota.canalTipo) ? 'ML_PAGA' : 'NOSSO'
}

/**
 * Calcula o DIFAL da nota.
 *
 * O frete entra na base junto com os produtos, rateado na mesma proporção entre
 * a parcela com redução e a sem redução, porque compõe o valor da operação.
 */
export function calcularDifal(nota: DadosNota, regra: RegraUf | undefined): ResultadoDifal {
  const responsavel = definirResponsavel(nota)

  const comReducaoProdutos = nota.itens
    .filter((i) => temReducao(i.ncm))
    .reduce((a, i) => a + (i.valorTotal || 0), 0)
  const semReducaoProdutos = nota.itens
    .filter((i) => !temReducao(i.ncm))
    .reduce((a, i) => a + (i.valorTotal || 0), 0)
  const totalProdutos = comReducaoProdutos + semReducaoProdutos

  // o frete segue a mesma proporção dos produtos
  const frete = nota.valorFrete || 0
  const fatorCom = totalProdutos > 0 ? comReducaoProdutos / totalProdutos : 0
  const valorComReducao = arredondar(comReducaoProdutos + frete * fatorCom)
  const valorSemReducao = arredondar(semReducaoProdutos + frete * (1 - fatorCom))

  const base = { valorComReducao, valorSemReducao }

  if (responsavel === 'SEM_DIFAL' || responsavel === 'CLIENTE') {
    return {
      responsavel,
      metodo: 'isento',
      ...base,
      baseCalculo: 0,
      difal: 0,
      detalhe: {
        motivo:
          responsavel === 'CLIENTE'
            ? 'Destinatário com inscrição estadual: o DIFAL é apurado por ele'
            : 'Operação dentro do estado de origem: não há diferencial',
      },
    }
  }

  if (!regra) {
    return {
      responsavel,
      metodo: 'isento',
      ...base,
      baseCalculo: 0,
      difal: 0,
      detalhe: { erro: `Sem alíquota cadastrada para ${nota.ufDestino}` },
    }
  }

  // A carga da origem depende da alíquota interestadual. Fora de 7% e 12% (uma
  // operação a 4%, por exemplo) não temos a carga equivalente do Anexo II, e
  // chutar daria um DIFAL errado em silêncio.
  const cargaOrigem = CARGA_ORIGEM[regra.interestadual]
  if (cargaOrigem === undefined) {
    return {
      responsavel,
      metodo: 'isento',
      ...base,
      baseCalculo: 0,
      difal: 0,
      detalhe: {
        erro:
          `alíquota interestadual de ${regra.interestadual}% não prevista para ${regra.uf}: ` +
          'o Convênio 52/91 define a carga da origem para 7% e 12%. Confira o cadastro do estado.',
      },
    }
  }

  // parcela com redução do Convênio 52/91
  let difalComReducao = 0
  let detalheReducao: Record<string, unknown> = {}
  if (valorComReducao > 0) {
    if (regra.metodo === 'prop') {
      const fator = CARGA_CONVENIO / regra.aliquotaInterna
      const diferenca = regra.aliquotaInterna - regra.interestadual
      difalComReducao = (valorComReducao * fator * diferenca) / 100
      detalheReducao = {
        metodo: 'prop',
        explicacao: 'Base reduzida vezes a diferença de alíquotas (posição do fisco estadual)',
        baseReduzida: arredondar(valorComReducao * fator),
        diferencaAliquotas: arredondar(diferenca),
      }
    } else {
      const cargaDevida = Math.max(0, CARGA_CONVENIO - cargaOrigem)
      difalComReducao = (valorComReducao * cargaDevida) / 100
      detalheReducao = {
        metodo: 'carga',
        explicacao: 'Carga total de 5,6% do Convênio 52/91 menos a já recolhida na origem',
        cargaTotal: CARGA_CONVENIO,
        cargaOrigem,
        cargaDevida: arredondar(cargaDevida),
      }
    }
  }

  // parcela sem redução: diferença cheia entre a alíquota interna e a interestadual
  let difalSemReducao = 0
  if (valorSemReducao > 0) {
    const interna = regra.aliquotaInterna + regra.fcp
    difalSemReducao = Math.max(0, (valorSemReducao * (interna - regra.interestadual)) / 100)
  }

  const difal = arredondar(difalComReducao + difalSemReducao)
  const metodo: MetodoDifal =
    valorComReducao > 0 ? (regra.metodo as MetodoDifal) : 'sem_reducao'

  return {
    responsavel,
    metodo,
    ...base,
    baseCalculo: arredondar(valorComReducao + valorSemReducao),
    difal,
    detalhe: {
      uf: regra.uf,
      aliquotaInterna: regra.aliquotaInterna,
      fcp: regra.fcp,
      interestadual: regra.interestadual,
      comReducao: {
        valor: valorComReducao,
        difal: arredondar(difalComReducao),
        ...detalheReducao,
      },
      semReducao: {
        valor: valorSemReducao,
        difal: arredondar(difalSemReducao),
        aliquotaCheia: arredondar(regra.aliquotaInterna + regra.fcp - regra.interestadual),
      },
      freteRateado: arredondar(frete),
    },
  }
}

function arredondar(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}
