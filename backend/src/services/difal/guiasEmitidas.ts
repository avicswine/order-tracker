/**
 * Registro das guias emitidas (aba "O que já pagamos"): o que foi gerado, o que o portal aceitou, o que o José
 * marcou como pago e alertas de pagamento em dobro ou esquecido. Aprovado pelo José em 20/11/2026.
 * O sistema não sabe sozinho se a guia foi paga (o pagamento é no banco): o José marca, com a data.
 */
import type { PrismaClient } from '@prisma/client'
import { lerResultadoLote } from './portalGnre'
import { prazoDoDifal, mlRecolheDifal, UFS_COM_COBRANCA } from './guias'
import { dataBR, somarDias } from '../separacao/datas'

/** guia aceita há mais que isso e não marcada como paga entra no alerta */
const DIAS_ALERTA_SEM_PAGAMENTO = 3

export interface GuiaEmitida {
  id: string
  empresa: string
  nfNumero: string
  clienteNome: string
  clienteUf: string
  estadoComCobranca: boolean
  canal: string | null
  ml: boolean
  mlLogistica: string | null
  mlOrderId: string | null
  valorNota: number
  difalCalculado: number
  calculoDetalhe: unknown
  itens: unknown
  emitidaEm: Date
  loteId: string
  ambiente: string | null
  /** dia (Brasília) em que a guia foi gerada */
  geradaEm: string
  enviadaEm: Date | null
  /** situação da guia no portal: 0 processada, 1/2 invalidada, 3 erro de comunicação, 4 pendente; null = sem resultado */
  situacaoPortal: string | null
  linhaDigitavel: string | null
  /** código de barras de 44 dígitos (vai no arquivo de pagamento do Sicredi) */
  codigoBarras: string | null
  /** valor da guia como o portal emitiu (é o que está no código de barras) */
  valorGuia: number | null
  /** último dia para pagar a guia (AAAA-MM-DD), como o portal devolveu */
  dataLimitePagamento: string | null
  /** arquivo de pagamento do Sicredi em que a guia já entrou */
  arquivoPagamento: { id: string; nome: string; criadoEm: Date } | null
  /** gerada depois do prazo legal: saiu só com o imposto, sem multa e juros */
  atrasada: boolean
  pagaEm: string | null
  valorPago: number | null
  comprovanteMlEnviadoEm: Date | null
}

export interface AlertaGuias {
  tipo: 'dobro' | 'sem_pagamento'
  texto: string
}

export async function listarGuiasEmitidas(prisma: PrismaClient): Promise<{ guias: GuiaEmitida[]; alertas: AlertaGuias[] }> {
  const [notas, lotes, arquivos] = await Promise.all([
    prisma.difalNota.findMany({ where: { guiaLoteId: { not: null } }, orderBy: { guiaGeradaEm: 'desc' } }),
    prisma.difalLoteGnre.findMany({ select: { id: true, empresa: true, ambiente: true, enviadoEm: true, resultadoXml: true } }),
    prisma.difalArquivoPagamento.findMany({ select: { id: true, nome: true, criadoEm: true } }),
  ])
  const arquivoPorId = new Map(arquivos.map((a) => [a.id, { id: a.id, nome: a.nome, criadoEm: a.criadoEm }]))
  const resultado = new Map(lotes.map((l) => [l.id, { ...l, guias: l.resultadoXml ? lerResultadoLote(l.resultadoXml).guias : [] }]))

  const guias: GuiaEmitida[] = notas.map((n) => {
    const lote = resultado.get(n.guiaLoteId!)
    const id = n.nfNumero.replace(/\D/g, '').slice(-10) // mesmo identificadorGuia da montagem do lote
    const g = lote?.guias.find((x) => x.identificadorGuia === id)
    const geradaEm = dataBR(n.guiaGeradaEm ?? new Date())
    const ml = mlRecolheDifal(n)
    return {
      id: n.id, empresa: n.empresa, nfNumero: n.nfNumero, clienteNome: n.clienteNome, clienteUf: n.clienteUf,
      estadoComCobranca: UFS_COM_COBRANCA.includes(n.clienteUf), canal: n.canalNome, ml, mlLogistica: n.mlLogistica,
      mlOrderId: n.mlOrderId, valorNota: n.valorNota, difalCalculado: n.difalCalculado, calculoDetalhe: n.calculoDetalhe, itens: n.itens,
      emitidaEm: n.emitidaEm, loteId: n.guiaLoteId!, ambiente: lote?.ambiente ?? null, geradaEm,
      enviadaEm: lote?.enviadoEm ?? null, situacaoPortal: g?.situacaoGuia ?? null, linhaDigitavel: g?.linhaDigitavel ?? null,
      codigoBarras: g?.codigoBarras ?? null, valorGuia: g?.valorGNRE ? Number(g.valorGNRE) : null, dataLimitePagamento: g?.dataLimitePagamento ?? null,
      arquivoPagamento: n.arquivoPagamentoId ? arquivoPorId.get(n.arquivoPagamentoId) ?? null : null,
      atrasada: prazoDoDifal(n.emitidaEm) < geradaEm,
      pagaEm: n.guiaPagaEm ? dataBR(n.guiaPagaEm) : null, valorPago: n.difalPagoGuia,
      comprovanteMlEnviadoEm: n.comprovanteMlEnviadoEm,
    }
  })

  const alertas: AlertaGuias[] = []
  // mesma nota com mais de uma guia aceita pelo portal, em qualquer lote de PRODUÇÃO (guia de teste não é paga:
  // a mesma NF testada e depois emitida de verdade não é dobro)
  const aceitas = new Map<string, string[]>()
  for (const l of resultado.values()) {
    if (l.ambiente !== 'producao') continue
    for (const g of l.guias) {
      if (g.situacaoGuia !== '0' || !g.identificadorGuia) continue
      const chave = `${l.empresa} NF ${g.identificadorGuia}`
      aceitas.set(chave, [...(aceitas.get(chave) ?? []), l.id])
    }
  }
  for (const [chave, ids] of aceitas) {
    if (ids.length > 1) alertas.push({ tipo: 'dobro', texto: `${chave}: ${ids.length} guias aceitas pelo portal (lotes ${ids.join(', ')})` })
  }
  const limite = somarDias(dataBR(), -DIAS_ALERTA_SEM_PAGAMENTO)
  const esquecidas = guias.filter((g) => g.ambiente === 'producao' && g.situacaoPortal === '0' && !g.pagaEm && g.geradaEm < limite)
  if (esquecidas.length) {
    alertas.push({
      tipo: 'sem_pagamento',
      texto: `${esquecidas.length} guia(s) aceita(s) há mais de ${DIAS_ALERTA_SEM_PAGAMENTO} dias e não marcada(s) como paga(s): ${esquecidas.slice(0, 8).map((g) => `${g.empresa} NF ${g.nfNumero}`).join(', ')}${esquecidas.length > 8 ? '…' : ''}`,
    })
  }
  return { guias, alertas }
}

/**
 * Marca (data AAAA-MM-DD) ou desmarca (null) guias como pagas. Só notas com guia gerada; marcar vale só para guia
 * aceita pelo portal em PRODUÇÃO (guia recusada ou de teste não tem como ser paga), põe a situação PAGO (sai do
 * "a pagar" do topo) e grava o valor pago = DIFAL calculado; desmarcar volta para PENDENTE.
 * Devolve quantas foram gravadas e quantas foram recusadas por não serem guia aceita em produção.
 */
export async function marcarGuiasPagas(prisma: PrismaClient, ids: string[], data: string | null): Promise<{ notas: number; recusadas: number }> {
  if (data !== null && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('data de pagamento deve estar em AAAA-MM-DD')
  let validos = ids
  if (data !== null) {
    const pagaveis = new Set((await listarGuiasEmitidas(prisma)).guias.filter((g) => g.ambiente === 'producao' && g.situacaoPortal === '0').map((g) => g.id))
    validos = ids.filter((id) => pagaveis.has(id))
  }
  const notas = await prisma.difalNota.findMany({ where: { id: { in: validos }, guiaLoteId: { not: null } }, select: { id: true, difalCalculado: true, situacao: true } })
  for (const n of notas) {
    await prisma.difalNota.update({
      where: { id: n.id },
      data: data
        ? { guiaPagaEm: new Date(`${data}T12:00:00Z`), difalPagoGuia: n.difalCalculado, situacao: 'PAGO' }
        : { guiaPagaEm: null, difalPagoGuia: null, ...(n.situacao === 'PAGO' && { situacao: 'PENDENTE' as const }) },
    })
  }
  return { notas: notas.length, recusadas: ids.length - notas.length }
}
