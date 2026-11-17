/**
 * Gera a PRÉVIA da imagem de rastreio e confere a quem a resposta seria enviada.
 * Não fala com o Mercado Livre e não envia nada — serve para olhar o resultado antes.
 *
 *   npx tsx src/scripts/previaRastreio.ts
 *
 * A imagem sai em previa-rastreio.png, na pasta do backend.
 */
import { writeFileSync } from 'fs'
import { gerarImagemRastreio, htmlDaImagem } from '../services/imagemRastreio'
import { destinatarioDaConversa } from '../services/mercadolivre'

const EXEMPLO = {
  nfNumero: '006324',
  transportadora: 'AZURELOG TRANSPORTES LTDA',
  previsao: new Date('2026-11-16T12:00:00'),
  eventos: [
    { descricao: 'CHEGADA - Chegada na unidade JUIZ DE FORA', data: '09/11/2026 às 13:49' },
    { descricao: 'SAIDA - Saida da unidade JOINVILLE', data: '08/11/2026 às 09:22' },
    { descricao: 'CHEGADA EM UNIDADE DE TRANSBORDO - JOINVILLE', data: '06/11/2026 às 00:40' },
    { descricao: 'SAIDA - Saida da unidade GASPAR', data: '05/11/2026 às 22:17' },
  ],
}

const VENDEDOR = '1794452398'
const COMPRADOR = '1171591907'
const AGENTE = '3037675074'

function conferirDestinatario(): void {
  const casos: Array<[string, Array<{ from: { user_id: string } }>, string | undefined, string]> = [
    ['comprador escreveu por último (hoje)',
      [{ from: { user_id: COMPRADOR } }, { from: { user_id: VENDEDOR } },
       { from: { user_id: COMPRADOR } }], undefined, COMPRADOR],
    ['conversa já migrada para o Agente do ML',
      [{ from: { user_id: AGENTE } }], undefined, AGENTE],
    ['sem histórico: cai no comprador do pedido',
      [], COMPRADOR, COMPRADOR],
    ['só mensagens nossas: cai no comprador do pedido',
      [{ from: { user_id: VENDEDOR } }], COMPRADOR, COMPRADOR],
  ]
  for (const [nome, msgs, buyer, esperado] of casos) {
    const obtido = destinatarioDaConversa(msgs, VENDEDOR, buyer)
    const ok = obtido === esperado
    console.log(`  ${ok ? 'OK  ' : 'ERRO'} ${nome} -> ${obtido}${ok ? '' : ` (esperado ${esperado})`}`)
    if (!ok) process.exitCode = 1
  }
  try {
    destinatarioDaConversa([], VENDEDOR, undefined)
    console.log('  ERRO sem histórico e sem comprador deveria recusar')
    process.exitCode = 1
  } catch {
    console.log('  OK   sem histórico e sem comprador: recusa em vez de chutar')
  }
}

function conferirPrivacidade(html: string): void {
  // o que NUNCA pode aparecer na imagem que vai para o cliente
  const proibidos: Array<[string, RegExp]> = [
    ['CPF/CNPJ', /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/],
    ['telefone', /\(\d{2}\)\s?\d{4,5}-?\d{4}/],
    ['palavra "CPF"', /\bCPF\b/i],
    ['palavra "destinatário"', /destinat/i],
  ]
  for (const [nome, re] of proibidos) {
    const achou = re.test(html)
    console.log(`  ${achou ? 'ERRO' : 'OK  '} ${nome} ${achou ? 'APARECE' : 'não aparece'} na imagem`)
    if (achou) process.exitCode = 1
  }
}

async function main(): Promise<void> {
  console.log('\nPara quem a resposta vai:')
  conferirDestinatario()

  const html = htmlDaImagem(EXEMPLO)
  console.log('\nPrivacidade da imagem:')
  conferirPrivacidade(html)

  const png = await gerarImagemRastreio(EXEMPLO)
  writeFileSync('previa-rastreio.png', png)
  console.log(`\nImagem gerada: previa-rastreio.png (${Math.round(png.length / 1024)} KB)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
