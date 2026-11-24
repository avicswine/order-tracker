/**
 * Gera o arquivo de pagamento do Sicredi (CNAB 240) com guias GNRE aceitas e ainda não pagas.
 * O arquivo não paga nada: o José sobe no Internet Banking e aprova lá.
 *
 * Conta de cada empresa: variáveis SICREDI_<AVIC|AGRO>_AGENCIA, _AGENCIA_DV, _CONTA e _CONTA_DV no Railway
 * (o José cadastra; os números não passam pelo chat nem pelo git). Convênio: informado pela gerente em 24/11/2026.
 */
import type { PrismaClient } from '@prisma/client'
import { listarGuiasEmitidas } from './guiasEmitidas'
import { montarRemessaTributos, nomeArquivoRemessa, type ContaSicredi, type PagamentoTributo } from './cnabSicredi'
import { dataBR } from '../separacao/datas'

const CONVENIO_SICREDI: Record<string, string> = { AVIC: '7SR1', AGRO: '7SR3' }

function contaDaEmpresa(empresa: string, cnpj: string, razaoSocial: string): ContaSicredi {
  const v = (campo: string) => process.env[`SICREDI_${empresa}_${campo}`]?.trim() ?? ''
  const convenio = CONVENIO_SICREDI[empresa]
  if (!convenio) throw new Error(`empresa ${empresa} sem convênio do Sicredi`)
  const agencia = v('AGENCIA')
  const conta = v('CONTA')
  const contaDv = v('CONTA_DV')
  const faltando = [!agencia && 'AGENCIA', !conta && 'CONTA', !contaDv && 'CONTA_DV'].filter(Boolean)
  if (faltando.length) throw new Error(`faltam no Railway as variáveis ${faltando.map((f) => `SICREDI_${empresa}_${f}`).join(', ')}`)
  return { cnpj, razaoSocial, convenio, agencia, agenciaDv: v('AGENCIA_DV'), conta, contaDv }
}

export interface ResultadoArquivo {
  nome: string
  conteudo: string
  guias: number
  total: number
  /** guias escolhidas que ficaram de fora, com o motivo */
  foraDoArquivo: { nfNumero: string; motivo: string }[]
}

export async function gerarArquivoPagamento(prisma: PrismaClient, empresa: string, ids: string[]): Promise<ResultadoArquivo> {
  const emitente = await prisma.difalEmitente.findUnique({ where: { empresa } })
  if (!emitente) throw new Error(`dados do emitente ${empresa} ainda não foram lidos de nenhuma nota`)
  const conta = contaDaEmpresa(empresa, emitente.cnpj, emitente.razaoSocial)
  const hoje = dataBR()

  const escolhidas = (await listarGuiasEmitidas(prisma)).guias.filter((g) => ids.includes(g.id))
  const foraDoArquivo: ResultadoArquivo['foraDoArquivo'] = []
  const entram: { id: string; pagamento: PagamentoTributo }[] = []
  for (const g of escolhidas) {
    const motivo = g.empresa !== empresa ? `é da ${g.empresa} (um arquivo por empresa)`
      : g.ambiente !== 'producao' ? 'guia de teste'
      : g.situacaoPortal !== '0' ? 'guia não aceita pelo portal'
      : g.pagaEm ? 'já marcada como paga'
      : g.arquivoPagamento ? `já está no arquivo ${g.arquivoPagamento.nome}`
      : !g.codigoBarras ? 'sem código de barras'
      : !g.dataLimitePagamento ? 'sem data limite de pagamento'
      : !(g.valorGuia && g.valorGuia > 0) ? 'sem o valor da guia devolvido pelo portal'
      : g.dataLimitePagamento < hoje ? `venceu em ${g.dataLimitePagamento.split('-').reverse().join('/')} (gere uma guia nova)`
      : null
    if (motivo) { foraDoArquivo.push({ nfNumero: g.nfNumero, motivo }); continue }
    entram.push({
      id: g.id,
      pagamento: {
        codigoBarras: g.codigoBarras!, orgao: `GNRE ${g.clienteUf}`, vencimento: g.dataLimitePagamento!,
        // o valor da guia emitida (o banco confere com o código de barras), não o calculado aqui
        dataPagamento: hoje, valor: g.valorGuia!, seuNumero: `NF ${g.nfNumero}`,
      },
    })
  }
  if (!entram.length) throw new Error(`nenhuma guia pode entrar no arquivo: ${foraDoArquivo.map((f) => `NF ${f.nfNumero} ${f.motivo}`).join('; ')}`)

  // sequencial e gravação numa transação: dois cliques juntos não geram o mesmo número nem a mesma guia duas vezes
  return prisma.$transaction(async (tx) => {
    const ultimo = await tx.difalArquivoPagamento.findFirst({ where: { empresa }, orderBy: { sequencial: 'desc' }, select: { sequencial: true } })
    const sequencial = (ultimo?.sequencial ?? 0) + 1
    const inicioDoDia = new Date(`${hoje}T00:00:00-03:00`)
    const jaHoje = await tx.difalArquivoPagamento.count({ where: { empresa, criadoEm: { gte: inicioDoDia } } })
    const nome = nomeArquivoRemessa(conta.convenio, Number(hoje.slice(8, 10)), jaHoje)
    const conteudo = montarRemessaTributos(conta, sequencial, new Date(), entram.map((e) => e.pagamento))
    const total = Math.round(entram.reduce((s, e) => s + e.pagamento.valor, 0) * 100) / 100
    const arquivo = await tx.difalArquivoPagamento.create({ data: { empresa, sequencial, nome, guias: entram.length, total, conteudo } })
    const marcadas = await tx.difalNota.updateMany({ where: { id: { in: entram.map((e) => e.id) }, arquivoPagamentoId: null }, data: { arquivoPagamentoId: arquivo.id } })
    if (marcadas.count !== entram.length) throw new Error('alguma guia entrou em outro arquivo ao mesmo tempo: gere de novo')
    return { nome, conteudo, guias: entram.length, total, foraDoArquivo }
  })
}
