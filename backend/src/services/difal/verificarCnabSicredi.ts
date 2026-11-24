/**
 * Conferência do arquivo CNAB 240 do Sicredi contra as posições do manual v1.5 (págs. 8, 9, 16 e 23).
 * Exemplo de cabeça: duas guias, R$ 10,00 e R$ 2,50 → total do lote R$ 12,50 (1250 centavos).
 *   npx tsx src/services/difal/verificarCnabSicredi.ts
 */
import { montarRemessaTributos, nomeArquivoRemessa } from './cnabSicredi'

let falhas = 0
function caso(nome: string, ok: boolean) {
  if (!ok) falhas++
  console.log(`${ok ? 'ok    ' : 'FALHOU'} ${nome}`)
}
/** campo pelas posições do manual (contadas a partir de 1, inclusivas) */
const campo = (linha: string, de: number, ate: number) => linha.slice(de - 1, ate)

const conta = { cnpj: '12.345.678/0001-90', razaoSocial: 'Agrogranja Comércio Ltda', convenio: '7SR3', agencia: '0123', agenciaDv: '', conta: '45981', contaDv: '3' }
const barras1 = '8'.padEnd(44, '1')
const barras2 = '8'.padEnd(44, '2')
const texto = montarRemessaTributos(conta, 7, new Date('2026-11-24T15:30:45-03:00'), [
  { codigoBarras: barras1, orgao: 'GNRE AL', vencimento: '2026-11-25', dataPagamento: '2026-11-24', valor: 10, seuNumero: 'NF 6464' },
  { codigoBarras: barras2, orgao: 'GNRE RN', vencimento: '2026-11-26', dataPagamento: '2026-11-24', valor: 2.5, seuNumero: 'NF 6515' },
])
const linhas = texto.split('\r\n')
caso('termina com CR+LF depois do trailer (linha finalizadora)', texto.endsWith('\r\n') && linhas[linhas.length - 1] === '')
const regs = linhas.slice(0, -1)
caso('6 registros: header arquivo, header lote, 2 segmentos O, trailer lote, trailer arquivo', regs.length === 6)
caso('todos com 240 posições', regs.every((l) => l.length === 240))
caso('só ASCII (sem acento)', /^[\x20-\x7e]*$/.test(regs.join('')))

const [ha, hl, o1, o2, tl, tz] = regs
caso('header arquivo: banco 748, lote 0000, tipo 0', campo(ha, 1, 3) === '748' && campo(ha, 4, 7) === '0000' && campo(ha, 8, 8) === '0')
caso('header arquivo: CNPJ (2 + 14 dígitos)', campo(ha, 18, 18) === '2' && campo(ha, 19, 32) === '12345678000190')
caso('header arquivo: convênio 7SR3 nas posições 33-36', campo(ha, 33, 36) === '7SR3')
caso('header arquivo: agência 00123, conta 000000045981 dígito 3', campo(ha, 53, 57) === '00123' && campo(ha, 59, 70) === '000000045981' && campo(ha, 71, 71) === '3')
caso('header arquivo: nome sem acento', campo(ha, 73, 102).trim() === 'AGROGRANJA COMERCIO LTDA')
caso('header arquivo: remessa (1), 24/11/2026 15:30:45', campo(ha, 143, 143) === '1' && campo(ha, 144, 151) === '24112026' && campo(ha, 152, 157) === '153045')
caso('header arquivo: sequencial 000007', campo(ha, 158, 163) === '000007')
caso('header lote: tipo 1, operação C, serviço 22, forma 11', campo(hl, 8, 8) === '1' && campo(hl, 9, 9) === 'C' && campo(hl, 10, 11) === '22' && campo(hl, 12, 13) === '11')
caso('header lote: lote 0001 e convênio', campo(hl, 4, 7) === '0001' && campo(hl, 33, 36) === '7SR3')
caso('segmento O: tipo 3, sequência 00001, segmento O, inclusão', campo(o1, 8, 8) === '3' && campo(o1, 9, 13) === '00001' && campo(o1, 14, 14) === 'O' && campo(o1, 15, 17) === '000')
caso('segmento O: código de barras nas posições 18-61', campo(o1, 18, 61) === barras1 && campo(o2, 18, 61) === barras2)
caso('segmento O: órgão, vencimento 25/11, pagamento 24/11', campo(o1, 62, 91).trim() === 'GNRE AL' && campo(o1, 92, 99) === '25112026' && campo(o1, 100, 107) === '24112026')
caso('segmento O: R$ 10,00 = 000000000001000; R$ 2,50 = 000000000000250', campo(o1, 108, 122) === '000000000001000' && campo(o2, 108, 122) === '000000000000250')
caso('segmento O: número do documento NF 6464', campo(o1, 123, 142).trim() === 'NF 6464')
caso('trailer lote: tipo 5, 4 registros (1 + 2 + 5), total 1250 centavos', campo(tl, 8, 8) === '5' && campo(tl, 18, 23) === '000004' && campo(tl, 24, 41) === '000000000000001250')
caso('trailer arquivo: lote 9999, tipo 9, 1 lote, 6 registros', campo(tz, 4, 7) === '9999' && campo(tz, 8, 8) === '9' && campo(tz, 18, 23) === '000001' && campo(tz, 24, 29) === '000006')
caso('nome do arquivo: 7SR3 + dia 24 + 1º do dia', nomeArquivoRemessa('7SR3', 24, 0) === '7SR32400.REM')

let recusou = false
try { montarRemessaTributos(conta, 1, new Date(), [{ codigoBarras: '123', orgao: 'X', vencimento: '2026-11-25', dataPagamento: '2026-11-24', valor: 1, seuNumero: 'NF 1' }]) } catch { recusou = true }
caso('recusa código de barras que não tem 44 dígitos', recusou)

console.log(falhas ? `\n${falhas} falha(s)` : '\ntodos ok')
process.exitCode = falhas ? 1 : 0
