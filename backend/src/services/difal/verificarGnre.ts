/**
 * Conferência do gerador de lote GNRE. Roda com:
 *     npx tsx src/services/difal/verificarGnre.ts
 *
 * Monta um lote de exemplo e confere contra as regras que o XSD oficial impõe
 * (município com 5 dígitos, valores TDec_1502, datas TData, CNPJ/CPF). Grava o XML
 * em /tmp para validação formal contra o schema, quando houver validador.
 */
import { writeFileSync } from 'fs'
import { montarLoteGnre, dividirEmLotes, ErroMontagemGnre, textoGnre, type GuiaGnre, type EmitenteGnre } from './gnre'
import { classificarCamposExtras, valorCampoExtra } from './guias'
import type { DifalNota } from '@prisma/client'

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
  identificadorGuia: '13439',
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
caso('identificadorGuia presente para casar a resposta', pega('identificadorGuia')[0] === '13439')

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
// texto livre no formato TString do XSD (até 60, sem espaço nas pontas, só U+0020..U+00FF)
caso('texto: espaços repetidos e nas pontas saem', textoGnre('  João  da Silva  ') === 'João da Silva')
caso('texto: aspas e travessão tipográficos viram simples', textoGnre('Agro \u201CBom\u201D \u2013 Ltda') === 'Agro "Bom" - Ltda')
caso('texto: emoji sai sem deixar espaço duplo', textoGnre('Fazenda \u{1F437} Feliz') === 'Fazenda Feliz')
caso('texto: corta em 60 caracteres', textoGnre('X'.repeat(70))?.length === 60)
caso('texto: só espaços vira ausente', textoGnre('   ') === undefined)
caso('identificadorGuia só com dígitos (XSD [0-9]{1,10})', /^[0-9]{1,10}$/.test(pega('identificadorGuia')[0] ?? ''))

// UF que não exige documento de origem (ex.: MS e PB na 100102): a guia vai sem o elemento
const xmlSemDoc = montarLoteGnre([{ ...guiaPiaui, ufFavorecida: 'MS', documentoOrigem: undefined, tipoDocumentoOrigem: undefined }], emitente)
caso('guia sem documento de origem não leva <documentoOrigem>', !xmlSemDoc.includes('<documentoOrigem'))

// campos extras obrigatórios da UF (GnreConfigUF), classificados pelo título/tipo
const cls = classificarCamposExtras([
  { codigo: '107', titulo: 'Chave de Acesso da NFe', tipo: 'T', obrigatorio: true },
  { codigo: '132', titulo: 'Data de Emissão', tipo: 'D', obrigatorio: true },
  { codigo: '106', titulo: 'OBSERVAÇÃO', tipo: 'T', obrigatorio: true },
  { codigo: '127', titulo: 'Informações complementares', tipo: 'T', obrigatorio: false },
  { codigo: '999', titulo: 'Campo novo qualquer', tipo: 'T', obrigatorio: true },
])
caso('extras: chave, data e observação reconhecidos', cls[0]?.conteudo === 'chaveNfe' && cls[1]?.conteudo === 'dataEmissao' && cls[2]?.conteudo === 'observacao')
caso('extras: opcional fica de fora', !cls.some((c) => c.codigo === '127'))
caso('extras: obrigatório desconhecido trava em vez de ir errado', cls.find((c) => c.codigo === '999')?.conteudo === 'desconhecido')
caso('extras: UF que exige produto trava a nota', classificarCamposExtras([], true)[0]?.conteudo === 'desconhecido')

// valores dos campos extras a partir da nota (emitidaEm guarda o horário de Brasília como se fosse UTC)
const notaMadrugada = { nfNumero: '013234', nfChave: '4'.repeat(44), emitidaEm: new Date('2026-11-19T01:30:00Z') } as DifalNota
caso('data de emissão de nota da 1h30 não volta um dia', valorCampoExtra({ codigo: '132', titulo: 'Data de Emissão', conteudo: 'dataEmissao' }, notaMadrugada) === '2026-11-19')
caso('observação: DIFAL NF + número sem zeros à esquerda', valorCampoExtra({ codigo: '106', titulo: 'OBSERVAÇÃO', conteudo: 'observacao' }, notaMadrugada) === 'DIFAL NF 13234')
caso('observação: número de 7 dígitos não é cortado', valorCampoExtra({ codigo: '106', titulo: 'OBSERVAÇÃO', conteudo: 'observacao' }, { ...notaMadrugada, nfNumero: '1234567' }) === 'NF 1234567')
caso('chave da NF-e vai inteira', valorCampoExtra({ codigo: '107', titulo: 'Chave', conteudo: 'chaveNfe' }, notaMadrugada)?.length === 44)

console.log(falhas === 0 ? '\nTodos os casos conferem.' : `\n${falhas} caso(s) com erro.`)
process.exit(falhas === 0 ? 0 : 1)
