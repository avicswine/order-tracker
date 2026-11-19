/**
 * Conferência do gerador de lote GNRE. Roda com:
 *     npx tsx src/services/difal/verificarGnre.ts
 *
 * Monta um lote de exemplo e confere contra as regras que o XSD oficial impõe
 * (município com 5 dígitos, valores TDec_1502, datas TData, CNPJ/CPF). Grava o XML
 * em /tmp para validação formal contra o schema, quando houver validador.
 */
import { writeFileSync } from 'fs'
import { montarLoteGnre, dividirEmLotes, ErroMontagemGnre, type GuiaGnre, type EmitenteGnre } from './gnre'

// dados de exemplo — NÃO são de cliente real
const emitente: EmitenteGnre = {
  cnpj: '47.715.256/0001-49',
  razaoSocial: 'AVIC VENTILACAO E EXAUSTAO INDUSTRIAL LTDA',
  endereco: 'R QUADRA A, LOTE 3, PAVLH A SALA 665',
  municipio: '11800', // Marau/RS é 4311809 no IBGE; o portal quer os 5 dígitos sem a UF
  uf: 'RS',
  cep: '99150-000',
}

const guiaPiaui: GuiaGnre = {
  ufFavorecida: 'PI',
  receita: '100102', // exemplo; o código real vem do GnreConfigUF da UF
  documentoOrigem: '13439',
  dataVencimento: '2026-12-10',
  valorPrincipal: 15, // R$ 1.000 x 1,5%
  referencia: { mes: '11', ano: '2026' },
  destinatario: { documento: '123.456.789-09', razaoSocial: 'Consumidor Exemplo', municipio: '11001' },
  identificadorGuia: 'AVIC-NF-13439',
}

const PADRAO_DATA = /^\d{4}-\d{2}-\d{2}$/
const PADRAO_DEC = /^(0|0\.[0-9]{2}|[1-9][0-9]{0,9}\.[0-9]{2})$/
const PADRAO_MUN = /^[0-9]{5}$/

let falhas = 0
function caso(nome: string, ok: boolean, detalhe = '') {
  if (!ok) falhas++
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${nome}${detalhe ? ' — ' + detalhe : ''}`)
}

const xml = montarLoteGnre([guiaPiaui], emitente)
const pega = (tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, 'g'))].map((m) => m[1])

console.log('Conferência do lote GNRE (layout 2.00)\n')
caso('raiz TLote_GNRE versão 2.00 no namespace do portal',
  xml.includes('<TLote_GNRE xmlns="http://www.gnre.pe.gov.br" versao="2.00">'))
caso('guia TDadosGNRE versão 2.00', xml.includes('<TDadosGNRE versao="2.00">'))
caso('ufFavorecida vem antes de tipoGnre (ordem do XSD)',
  xml.indexOf('<ufFavorecida>') < xml.indexOf('<tipoGnre>'))
caso('CNPJ do emitente com 14 dígitos', pega('CNPJ')[0] === '47715256000149', pega('CNPJ')[0])
caso('CEP com 8 dígitos', pega('cep')[0] === '99150000', pega('cep')[0])
caso('municípios com 5 dígitos (TCodMunIBGE)', pega('municipio').every((m) => PADRAO_MUN.test(m)), pega('municipio').join(','))
caso('data de vencimento em AAAA-MM-DD (TData)', PADRAO_DATA.test(pega('dataVencimento')[0]), pega('dataVencimento')[0])
caso('valor principal tipo 11 no formato TDec_1502', xml.includes('<valor tipo="11">15.00</valor>'))
caso('valorGNRE igual à soma dos valores', pega('valorGNRE')[0] === '15.00', pega('valorGNRE')[0])
caso('todos os valores respeitam TDec_1502', [...pega('valor'), ...pega('valorGNRE')].every((v) => PADRAO_DEC.test(v)))
caso('CPF do destinatário com 11 dígitos', pega('CPF')[0] === '12345678909', pega('CPF')[0])
caso('documento de origem é NF-e (tipo 10)', xml.includes('<documentoOrigem tipo="10">13439</documentoOrigem>'))
caso('nenhum campo do layout 1.00 (c01_, c02_...)', !/<c\d{2}_/.test(xml))
caso('identificadorGuia presente para casar a resposta', pega('identificadorGuia')[0] === 'AVIC-NF-13439')

// recusas que devem acontecer
function recusa(nome: string, fn: () => void) {
  try { fn(); caso(nome, false, 'aceitou o que devia recusar') }
  catch (e) { caso(nome, e instanceof ErroMontagemGnre, (e as Error).message) }
}
recusa('recusa município com 7 dígitos', () =>
  montarLoteGnre([{ ...guiaPiaui, destinatario: { ...guiaPiaui.destinatario, municipio: '2211001' } }], emitente))
recusa('recusa guia sem código de receita', () => montarLoteGnre([{ ...guiaPiaui, receita: '' }], emitente))
recusa('recusa valor zero', () => montarLoteGnre([{ ...guiaPiaui, valorPrincipal: 0 }], emitente))
recusa('recusa data fora de AAAA-MM-DD', () => montarLoteGnre([{ ...guiaPiaui, dataVencimento: '10/12/2026' }], emitente))
recusa('recusa lote com 51 guias', () => montarLoteGnre(Array(51).fill(guiaPiaui), emitente))

const lotes = dividirEmLotes(Array(120).fill(guiaPiaui))
caso('120 guias viram 3 lotes (50+50+20)', lotes.length === 3 && lotes[2].length === 20)

writeFileSync('/tmp/lote_gnre_exemplo.xml', xml, 'utf-8')
console.log(`\nXML de exemplo gravado em /tmp/lote_gnre_exemplo.xml (${xml.length} bytes)`)
console.log(falhas === 0 ? '\nTodos os casos conferem.' : `\n${falhas} caso(s) com erro.`)
process.exit(falhas === 0 ? 0 : 1)
