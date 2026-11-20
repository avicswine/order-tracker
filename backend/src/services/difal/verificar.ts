/**
 * Conferência do cálculo do DIFAL. Roda com:
 *     npx tsx src/services/difal/verificar.ts
 *
 * Os casos têm números redondos de propósito, para poderem ser conferidos de
 * cabeça contra a calculadora interna (Calculadora_DIFAL_8436_revisada.html).
 */
import { calcularDifal, type DadosNota, type RegraUf } from './calculo'
import { prazoDoDifal } from './guias'

const PI: RegraUf = { uf: 'PI', nome: 'Piauí', aliquotaInterna: 22.5, fcp: 0, interestadual: 7, metodo: 'carga' }
const CE: RegraUf = { uf: 'CE', nome: 'Ceará', aliquotaInterna: 20, fcp: 0, interestadual: 7, metodo: 'prop' }
const SP: RegraUf = { uf: 'SP', nome: 'São Paulo', aliquotaInterna: 18, fcp: 0, interestadual: 12, metodo: 'carga' }

interface Caso {
  nome: string
  nota: DadosNota
  regra: RegraUf | undefined
  esperaDifal: number
  esperaResponsavel: string
  porque: string
}

const casos: Caso[] = [
  {
    nome: 'Piauí, R$ 1.000 de produto 8436, cliente sem IE, venda de balcão',
    nota: {
      ufDestino: 'PI',
      temInscricaoEstadual: false,
      canalTipo: null,
      itens: [{ ncm: '84362900', valorTotal: 1000 }],
    },
    regra: PI,
    esperaDifal: 15,
    esperaResponsavel: 'NOSSO',
    porque: 'carga de 5,6% menos os 4,1% da origem = 1,5% de R$ 1.000',
  },
  {
    nome: 'Piauí, mesma nota, mas vendida no Mercado Livre',
    nota: {
      ufDestino: 'PI',
      temInscricaoEstadual: false,
      canalTipo: 'MercadoLivre',
      itens: [{ ncm: '84362900', valorTotal: 1000 }],
    },
    regra: PI,
    esperaDifal: 15,
    esperaResponsavel: 'ML_PAGA',
    porque: 'mesmo valor, mas quem recolhe é o ML — e depois cobra de nós',
  },
  {
    nome: 'Piauí, cliente COM inscrição estadual',
    nota: {
      ufDestino: 'PI',
      temInscricaoEstadual: true,
      canalTipo: null,
      itens: [{ ncm: '84362900', valorTotal: 1000 }],
    },
    regra: PI,
    esperaDifal: 0,
    esperaResponsavel: 'CLIENTE',
    porque: 'contribuinte apura o próprio DIFAL: nada a recolher por nós',
  },
  {
    nome: 'Ceará, R$ 1.000 de produto 8436 (método próprio do estado)',
    nota: {
      ufDestino: 'CE',
      temInscricaoEstadual: false,
      canalTipo: null,
      itens: [{ ncm: '84362900', valorTotal: 1000 }],
    },
    regra: CE,
    esperaDifal: 36.4,
    esperaResponsavel: 'NOSSO',
    porque: 'base reduzida (5,6/20 = 28%) vezes a diferença de alíquotas (13%) = 3,64%',
  },
  {
    nome: 'São Paulo, R$ 1.000 de produto 8436',
    nota: {
      ufDestino: 'SP',
      temInscricaoEstadual: false,
      canalTipo: null,
      itens: [{ ncm: '84362900', valorTotal: 1000 }],
    },
    regra: SP,
    esperaDifal: 0,
    esperaResponsavel: 'NOSSO',
    porque: 'origem a 12% já recolhe 7%, acima da carga de 5,6%: não sobra diferencial',
  },
  {
    nome: 'Piauí, produto FORA do 8436 (sem redução), R$ 1.000',
    nota: {
      ufDestino: 'PI',
      temInscricaoEstadual: false,
      canalTipo: null,
      itens: [{ ncm: '85015110', valorTotal: 1000 }],
    },
    regra: PI,
    esperaDifal: 155,
    esperaResponsavel: 'NOSSO',
    porque: 'sem redução: diferença cheia de 22,5% menos 7% = 15,5%',
  },
  {
    nome: 'Venda dentro do RS',
    nota: {
      ufDestino: 'RS',
      temInscricaoEstadual: false,
      canalTipo: null,
      itens: [{ ncm: '84362900', valorTotal: 1000 }],
    },
    regra: undefined,
    esperaDifal: 0,
    esperaResponsavel: 'SEM_DIFAL',
    porque: 'operação interna não tem diferencial de alíquota',
  },
  {
    nome: 'Piauí, R$ 900 de 8436 + R$ 100 fora + R$ 100 de frete',
    nota: {
      ufDestino: 'PI',
      temInscricaoEstadual: false,
      canalTipo: null,
      valorFrete: 100,
      itens: [
        { ncm: '84362900', valorTotal: 900 },
        { ncm: '73269090', valorTotal: 100 },
      ],
    },
    regra: PI,
    esperaDifal: 31.9,
    esperaResponsavel: 'NOSSO',
    porque: 'frete rateado: 990 x 1,5% = 14,85 mais 110 x 15,5% = 17,05, total 31,90',
  },
  {
    nome: 'Piauí, R$ 1.000 de produto 8436 com R$ 100 de desconto na NF (NF de R$ 900)',
    nota: {
      ufDestino: 'PI',
      temInscricaoEstadual: false,
      canalTipo: null,
      valorNota: 900,
      itens: [{ ncm: '84362900', valorTotal: 1000 }],
    },
    regra: PI,
    esperaDifal: 13.5,
    esperaResponsavel: 'NOSSO',
    porque: 'a base é o valor total da NF: 900 x 1,5% = 13,50 (desconto sai da base)',
  },
  {
    nome: 'Piauí, R$ 800 de 8436 + R$ 200 fora, NF de R$ 1.100 (IPI e outras despesas)',
    nota: {
      ufDestino: 'PI',
      temInscricaoEstadual: false,
      canalTipo: null,
      valorNota: 1100,
      itens: [
        { ncm: '84362900', valorTotal: 800 },
        { ncm: '73269090', valorTotal: 200 },
      ],
    },
    regra: PI,
    esperaDifal: 47.3,
    esperaResponsavel: 'NOSSO',
    porque: 'NF repartida 80/20: 880 x 1,5% = 13,20 mais 220 x 15,5% = 34,10, total 47,30',
  },
]

let falhas = 0
console.log('Conferência do cálculo do DIFAL\n')
for (const c of casos) {
  const r = calcularDifal(c.nota, c.regra)
  const okValor = Math.abs(r.difal - c.esperaDifal) < 0.01
  const okResp = r.responsavel === c.esperaResponsavel
  const ok = okValor && okResp
  if (!ok) falhas++
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${c.nome}`)
  console.log(`      esperado: R$ ${c.esperaDifal.toFixed(2)} · ${c.esperaResponsavel}`)
  console.log(`      obtido:   R$ ${r.difal.toFixed(2)} · ${r.responsavel} (${r.metodo})`)
  console.log(`      ${c.porque}\n`)
}

// Prazo do DIFAL (regra do José, 20/11/2026): dia da emissão; a partir das 17h, fim de semana ou feriado,
// o próximo dia útil. O horário é o de Brasília, guardado como se fosse UTC.
const prazos: [string, string, string][] = [
  ['quinta 10h', '2026-11-19T10:00:00Z', '2026-11-19'],
  ['quinta 16h59', '2026-11-19T16:59:00Z', '2026-11-19'],
  ['quinta 17h (sexta 20/11 é feriado)', '2026-11-19T17:00:00Z', '2026-11-23'],
  ['quarta 18h', '2026-11-18T18:00:00Z', '2026-11-19'],
  ['sábado 9h', '2026-11-21T09:00:00Z', '2026-11-23'],
]
console.log('\nConferência do prazo do DIFAL\n')
for (const [nome, emitida, esperado] of prazos) {
  const obtido = prazoDoDifal(new Date(emitida))
  if (obtido !== esperado) falhas++
  console.log(`${obtido === esperado ? 'OK  ' : 'FALHA'} ${nome}: vence ${obtido} (esperado ${esperado})`)
}

console.log(falhas === 0 ? `\nTodos os ${casos.length + prazos.length} casos conferem.` : `\n${falhas} caso(s) com erro.`)
process.exit(falhas === 0 ? 0 : 1)
