/**
 * Alíquotas internas e método de cálculo do DIFAL, por estado de destino.
 *
 * Os valores vêm da calculadora interna da AvicSwine/AgroGranja
 * (Calculadora_DIFAL_8436_revisada.html, revisada em 05/11/2026), que é a
 * referência que a contabilidade usa hoje.
 *
 * `metodo`:
 *   carga — carga total de 5,6% do Convênio 52/91 menos a já recolhida na origem
 *   prop  — base reduzida vezes a diferença de alíquotas (posição do fisco local)
 *
 * `posicaoFisco` diz se há manifestação do fisco estadual sustentando o cálculo.
 * Onde é false, a regra aplicada é a geral do convênio e ainda não foi validada.
 */
import { PrismaClient } from '@prisma/client'

export interface SeedUf {
  uf: string
  nome: string
  aliquotaInterna: number
  fcp: number
  interestadual: number
  metodo: 'carga' | 'prop'
  posicaoFisco: boolean
  nota?: string
}

export const ALIQUOTAS: SeedUf[] = [
  { uf: 'AC', nome: 'Acre', aliquotaInterna: 19, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'AL', nome: 'Alagoas', aliquotaInterna: 20.5, fcp: 1, interestadual: 7, metodo: 'carga', posicaoFisco: false, nota: 'Alíquota de 20,5% desde 01/04/2026. Confirmar se o FECOEP de 1% alcança o produto.' },
  { uf: 'AM', nome: 'Amazonas', aliquotaInterna: 20, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'AP', nome: 'Amapá', aliquotaInterna: 18, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'BA', nome: 'Bahia', aliquotaInterna: 20.5, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false, nota: 'RICMS/BA, art. 266, I, b, mantém a carga de 5,6%. Falta confirmar a forma de cálculo para não contribuinte.' },
  { uf: 'CE', nome: 'Ceará', aliquotaInterna: 20, fcp: 0, interestadual: 7, metodo: 'prop', posicaoFisco: true, nota: 'Norma de Execução 01/2024 e orientação da SEFAZ/CE. Base reduzida em 72% e diferença de 13%, sem usar a carga de origem.' },
  { uf: 'DF', nome: 'Distrito Federal', aliquotaInterna: 20, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'ES', nome: 'Espírito Santo', aliquotaInterna: 17, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'GO', nome: 'Goiás', aliquotaInterna: 19, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'MA', nome: 'Maranhão', aliquotaInterna: 23, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'MG', nome: 'Minas Gerais', aliquotaInterna: 18, fcp: 0, interestadual: 12, metodo: 'carga', posicaoFisco: true, nota: 'RICMS/MG, Anexo II, Parte 1, item 20.2, dispensa a complementação, exceto na operação a 4%.' },
  { uf: 'MS', nome: 'Mato Grosso do Sul', aliquotaInterna: 17, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'MT', nome: 'Mato Grosso', aliquotaInterna: 17, fcp: 0, interestadual: 7, metodo: 'prop', posicaoFisco: false, nota: 'Nota Técnica 022/2024 da SEFAZ/MT usa base reduzida vezes diferença de alíquotas, mas não cita o Convênio 52/91. Validar.' },
  { uf: 'PA', nome: 'Pará', aliquotaInterna: 19, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: true, nota: 'Base única, conforme orientação recebida pela contabilidade em 28/10/2026. Carga de 1,5%.' },
  { uf: 'PB', nome: 'Paraíba', aliquotaInterna: 20, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'PE', nome: 'Pernambuco', aliquotaInterna: 20.5, fcp: 0, interestadual: 7, metodo: 'prop', posicaoFisco: true, nota: 'RICMS/PE, art. 103-D, e Consulta DLO 59/2024. A base é reduzida e recebe a diferença entre as alíquotas.' },
  { uf: 'PI', nome: 'Piauí', aliquotaInterna: 22.5, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: true, nota: 'A SEFAZ/PI manda considerar a carga efetiva e as reduções do Convênio 52/91 (Parecer UNATRI 35/2022). A exclusão do Piauí era só da cláusula de estorno de crédito.' },
  { uf: 'PR', nome: 'Paraná', aliquotaInterna: 19.5, fcp: 0, interestadual: 12, metodo: 'carga', posicaoFisco: false },
  { uf: 'RJ', nome: 'Rio de Janeiro', aliquotaInterna: 20, fcp: 2, interestadual: 12, metodo: 'carga', posicaoFisco: false, nota: 'Operação com Convênio 52/91 não paga FECP. Confirmar o DIFAL, porque há consulta da SEFAZ/RJ que pede cuidado com redução de base.' },
  { uf: 'RN', nome: 'Rio Grande do Norte', aliquotaInterna: 20, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'RO', nome: 'Rondônia', aliquotaInterna: 19.5, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false, nota: 'O TATE/RO negou a redução em nota sem DIFAL pago (decisão de 2026). Pague a guia antes da saída.' },
  { uf: 'RR', nome: 'Roraima', aliquotaInterna: 20, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'SC', nome: 'Santa Catarina', aliquotaInterna: 17, fcp: 0, interestadual: 12, metodo: 'carga', posicaoFisco: false },
  { uf: 'SE', nome: 'Sergipe', aliquotaInterna: 19, fcp: 1, interestadual: 7, metodo: 'carga', posicaoFisco: false, nota: 'A exclusão de Sergipe é só da cláusula de estorno de crédito, não da redução. Não há orientação da SEFAZ/SE para este cálculo. A planilha do Mercado Livre usa 20%: confirmar qual vale.' },
  { uf: 'SP', nome: 'São Paulo', aliquotaInterna: 18, fcp: 0, interestadual: 12, metodo: 'carga', posicaoFisco: true, nota: 'RICMS/SP, art. 56, usa a carga efetiva interna, de 5,6%.' },
  { uf: 'TO', nome: 'Tocantins', aliquotaInterna: 20, fcp: 0, interestadual: 7, metodo: 'carga', posicaoFisco: false },
  { uf: 'RS', nome: 'Rio Grande do Sul', aliquotaInterna: 17, fcp: 0, interestadual: 0, metodo: 'carga', posicaoFisco: true, nota: 'Estado de origem: operação interna, sem diferencial.' },
]

/** Grava as alíquotas no banco, preservando ajustes feitos pela contabilidade. */
export async function semearAliquotas(prisma: PrismaClient): Promise<number> {
  let gravadas = 0
  for (const a of ALIQUOTAS) {
    await prisma.difalAliquota.upsert({
      where: { uf: a.uf },
      create: a,
      // só completa o que falta; não sobrescreve alíquota ajustada à mão
      update: { nome: a.nome, nota: a.nota },
    })
    gravadas++
  }
  return gravadas
}
