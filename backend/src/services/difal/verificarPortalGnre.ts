/**
 * Conferência do cliente do Portal GNRE sem falar com o portal:
 *     npx tsx src/services/difal/verificarPortalGnre.ts
 * Monta o envelope SOAP e lê respostas de exemplo montadas a partir dos XSD do manual.
 */
import { montarEnvelope, extrairRetorno, lerConfigUf, lerRecibo, lerResultadoLote, soapAction, ErroPortalGnre } from './portalGnre'

let falhas = 0
function caso(nome: string, ok: boolean, detalhe = '') {
  if (!ok) falhas++
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${nome}${detalhe ? ' — ' + detalhe : ''}`)
}

console.log('Conferência do cliente do Portal GNRE\n')

// envelope
const env = montarEnvelope('loteRecepcao', '<?xml version="1.0" encoding="UTF-8"?>\n<TLote_GNRE xmlns="http://www.gnre.pe.gov.br" versao="2.00"><guias/></TLote_GNRE>')
caso('envelope SOAP 1.2', env.includes('xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"'))
caso('cabeçalho gnreCabecMsg no namespace do serviço', env.includes('<gnreCabecMsg xmlns="http://www.gnre.pe.gov.br/webservice/GnreLoteRecepcao">'))
caso('versaoDados 2.00 para o lote', env.includes('<versaoDados>2.00</versaoDados>'))
caso('declaração <?xml?> do lote removida de dentro do Body', (env.match(/<\?xml/g) ?? []).length === 1)
caso('soapAction do ConfigUF conforme o WSDL', soapAction('configUf') === 'http://www.gnre.pe.gov.br/webservice/GnreConfigUF/consultar')
caso('resposta em gnreRespostaMsg (nome do WSDL) também é lida', lerRecibo(extrairRetorno('<e><Body><gnreRespostaMsg>&lt;TRetLote_GNRE&gt;&lt;situacaoRecepcao&gt;&lt;codigo&gt;100&lt;/codigo&gt;&lt;descricao&gt;ok&lt;/descricao&gt;&lt;/situacaoRecepcao&gt;&lt;/TRetLote_GNRE&gt;</gnreRespostaMsg></Body></e>')).situacao.codigo === '100')
caso('configUf usa versaoDados 1.00', montarEnvelope('configUf', '<x/>').includes('<versaoDados>1.00</versaoDados>'))

// retorno escapado dentro do envelope
const respostaEscapada =
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  '<ns2:gnreLoteRecepcaoResponse xmlns:ns2="http://www.gnre.pe.gov.br/webservice/GnreLoteRecepcao">' +
  '<ns2:gnreRetornoMsg>&lt;TRetLote_GNRE xmlns="http://www.gnre.pe.gov.br"&gt;&lt;ambiente&gt;2&lt;/ambiente&gt;' +
  '&lt;situacaoRecepcao&gt;&lt;codigo&gt;100&lt;/codigo&gt;&lt;descricao&gt;Lote recebido com sucesso&lt;/descricao&gt;&lt;/situacaoRecepcao&gt;' +
  '&lt;recibo&gt;&lt;numero&gt;1234567890&lt;/numero&gt;&lt;dataHoraRecibo&gt;2026-11-18T15:00:00&lt;/dataHoraRecibo&gt;&lt;tempoEstimadoProc&gt;30000&lt;/tempoEstimadoProc&gt;&lt;/recibo&gt;' +
  '&lt;/TRetLote_GNRE&gt;</ns2:gnreRetornoMsg></ns2:gnreLoteRecepcaoResponse></soap:Body></soap:Envelope>'
const recibo = lerRecibo(extrairRetorno(respostaEscapada))
caso('recibo: situação 100', recibo.situacao.codigo === '100', recibo.situacao.descricao)
caso('recibo: número 1234567890', recibo.recibo?.numero === '1234567890')
caso('recibo: tempo estimado 30000 ms', recibo.recibo?.tempoEstimadoMs === 30000)

// retorno aninhado (sem escapar)
const respostaAninhada =
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><gnreLoteRecepcaoResponse xmlns="http://www.gnre.pe.gov.br/webservice/GnreLoteRecepcao">' +
  '<gnreRetornoMsg><TRetLote_GNRE xmlns="http://www.gnre.pe.gov.br"><ambiente>2</ambiente><situacaoRecepcao><codigo>402</codigo><descricao>Lote inválido</descricao><guiaErro>1</guiaErro></situacaoRecepcao></TRetLote_GNRE></gnreRetornoMsg>' +
  '</gnreLoteRecepcaoResponse></soap:Body></soap:Envelope>'
const recusa = lerRecibo(extrairRetorno(respostaAninhada))
caso('recusa: situação 402 sem recibo', recusa.situacao.codigo === '402' && recusa.recibo === undefined, recusa.situacao.descricao)

// falha SOAP
try {
  extrairRetorno('<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault><soap:Reason><soap:Text xml:lang="pt">Certificado não habilitado</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>')
  caso('falha SOAP vira erro', false, 'não lançou')
} catch (e) {
  caso('falha SOAP vira erro legível', e instanceof ErroPortalGnre && /Certificado não habilitado/.test((e as Error).message), (e as Error).message)
}

// configuração da UF (estrutura do config_uf_v1.00.xsd)
const cfg = lerConfigUf(
  '<TConfigUf xmlns="http://www.gnre.pe.gov.br"><ambiente>2</ambiente><uf>PI</uf>' +
  '<situacaoConsulta><codigo>450</codigo><descricao>Consulta realizada com sucesso</descricao></situacaoConsulta>' +
  '<receitas>' +
  '<receita codigo="100102" descricao="ICMS Consumidor Final não contribuinte outra UF por Operação"><exigeDetalhamentoReceita>N</exigeDetalhamentoReceita><exigeProduto>N</exigeProduto><exigePeriodoReferencia>N</exigePeriodoReferencia><exigeDocumentoOrigem>S</exigeDocumentoOrigem>' +
  '<tiposDocumentosOrigem><tipoDocumentoOrigem><codigo>10</codigo><descricao>Nota Fiscal Eletrônica</descricao></tipoDocumentoOrigem></tiposDocumentosOrigem>' +
  '<exigeContribuinteDestinatario>S</exigeContribuinteDestinatario><exigeDataVencimento>S</exigeDataVencimento><exigeCamposAdicionais>N</exigeCamposAdicionais><aceitaPgPix>S</aceitaPgPix></receita>' +
  '<receita codigo="100056" descricao="ICMS Substituição Tributária por Apuração" courier="S"><exigeDetalhamentoReceita>N</exigeDetalhamentoReceita><exigeProduto>N</exigeProduto><exigePeriodoReferencia>S</exigePeriodoReferencia><exigeDocumentoOrigem>N</exigeDocumentoOrigem><exigeContribuinteDestinatario>N</exigeContribuinteDestinatario><exigeCamposAdicionais>S</exigeCamposAdicionais>' +
  '<camposAdicionais><campoAdicional><obrigatorio>S</obrigatorio><codigo>22</codigo><tipo>T</tipo><titulo>Inscrição Estadual</titulo></campoAdicional></camposAdicionais><aceitaPgPix>N</aceitaPgPix></receita>' +
  '</receitas><qtdMaximas><guiasPorLote>50</guiasPorLote><itensPorGuia>100</itensPorGuia></qtdMaximas></TConfigUf>'
)
caso('configUF: UF e situação', cfg.uf === 'PI' && cfg.situacao.codigo === '450')
caso('acentos em entidade numérica (&#xE7;) são decodificados', lerConfigUf('<TConfigUf><situacaoConsulta><codigo>450</codigo><descricao>Configura&#xE7;&#xE3;o ok</descricao></situacaoConsulta></TConfigUf>').situacao.descricao === 'Configuração ok')
caso('configUF: 2 receitas lidas dos atributos', cfg.receitas.length === 2 && cfg.receitas[0].codigo === '100102', cfg.receitas.map((r) => r.codigo).join(','))
caso('configUF: receita 100102 exige documento de origem NF-e (10)', cfg.receitas[0].exigeDocumentoOrigem && cfg.receitas[0].tiposDocumentosOrigem[0]?.codigo === '10')
caso('configUF: receita 100056 é courier e tem campo adicional obrigatório', cfg.receitas[1].courier && cfg.receitas[1].camposAdicionais[0]?.obrigatorio)
caso('configUF: limite de 50 guias por lote', cfg.limites.guiasPorLote === '50')

// resultado do lote (lote_gnre_result_v2.00.xsd)
const res = lerResultadoLote(
  '<TResultLote_GNRE xmlns="http://www.gnre.pe.gov.br"><ambiente>2</ambiente><numeroRecibo>1234567890</numeroRecibo>' +
  '<situacaoProcess><codigo>402</codigo><descricao>Lote processado com sucesso</descricao></situacaoProcess><resultado>' +
  '<guia versao="2.00"><situacaoGuia>0</situacaoGuia><TDadosGNRE versao="2.00"><ufFavorecida>PI</ufFavorecida><itensGNRE><item><documentoOrigem tipo="10">13439</documentoOrigem></item></itensGNRE><valorGNRE>15.00</valorGNRE><identificadorGuia>AVIC-NF-13439</identificadorGuia></TDadosGNRE>' +
  '<linhaDigitavel>85620000000150000000000000000000000000000000</linhaDigitavel><codigoBarras>8562000000015000000000000000000000000000</codigoBarras><qrcodePayload>00020126...6304ABCD</qrcodePayload><dataLimitePagamento>2026-11-18</dataLimitePagamento></guia>' +
  '<guia versao="2.00"><situacaoGuia>2</situacaoGuia><TDadosGNRE versao="2.00"><ufFavorecida>BA</ufFavorecida><identificadorGuia>AVIC-NF-13440</identificadorGuia></TDadosGNRE>' +
  '<motivosRejeicao><motivo><codigo>213</codigo><descricao>Receita não aceita para a UF</descricao><campo>receita</campo></motivo></motivosRejeicao></guia>' +
  '<pdfGuias>JVBERi0xLjQK</pdfGuias></resultado></TResultLote_GNRE>'
)
caso('resultado: situação do lote 402', res.situacao.codigo === '402' && res.numeroRecibo === '1234567890')
caso('resultado: 2 guias', res.guias.length === 2)
caso('resultado: guia 1 com sucesso, identificador e linha digitável', res.guias[0].situacaoGuia === '0' && res.guias[0].identificadorGuia === 'AVIC-NF-13439' && !!res.guias[0].linhaDigitavel)
caso('resultado: guia 1 traz valor e PIX', res.guias[0].valorGNRE === '15.00' && !!res.guias[0].qrcodePayload)
caso('resultado: guia 2 invalidada pela UF com motivo 213 no campo receita', res.guias[1].situacaoGuia === '2' && res.guias[1].motivos[0]?.codigo === '213' && res.guias[1].motivos[0]?.campo === 'receita')
caso('resultado: PDF em base64 presente', res.pdfGuias === 'JVBERi0xLjQK')

console.log(falhas === 0 ? '\nTodos os casos conferem.' : `\n${falhas} caso(s) com erro.`)
process.exit(falhas === 0 ? 0 : 1)
