import { Prisma, SeparacaoEventoTipo, SeparacaoStatus } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { listarEmpresasBling } from '../../routes/bling'
import type { OperadorPayload } from '../../middleware/requireOperador'
import { bling, MODO_MOCK } from './bling'
import { getConfig } from './config'
import { explodirItensNf } from './explosao'
import { emitir } from './eventos'
import { normalizarNumeroNf, parsearChaveDanfe } from './danfe'
import { dataBR, meiaNoiteBR, somarDias } from './datas'

// Regras de negócio das tarefas de separação.
// Estados: AGUARDANDO_TRIAGEM → PENDENTE → EM_SEPARACAO → SEPARADO → CONCLUIDO (+ IGNORADA, CANCELADA)

export class ErroSeparacao extends Error {
  status: number
  codigo: string
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem)
    this.status = status
    this.codigo = codigo
  }
}

const EVENTOS_NA_RESPOSTA = 60

// ---------- helpers ----------

function normalizarSku(s: string): string {
  return (s || '').trim().toLowerCase()
}

export function resumoItens(itens: { qtdEsperada: number; qtdBipada: number; concluidoEm: Date | null }[]) {
  const total = itens.length
  const concluidos = itens.filter(i => i.concluidoEm !== null).length
  const unidadesEsperadas = itens.reduce((s, i) => s + i.qtdEsperada, 0)
  const unidadesBipadas = itens.reduce((s, i) => s + Math.min(i.qtdBipada, i.qtdEsperada), 0)
  return { total, concluidos, unidadesEsperadas, unidadesBipadas, completo: total > 0 && concluidos === total }
}

const INCLUDE_TAREFA = {
  operador: { select: { id: true, nome: true } },
  triadoPor: { select: { id: true, nome: true } },
  finalizadoPor: { select: { id: true, nome: true } },
} satisfies Prisma.SeparacaoTarefaInclude

const INCLUDE_TAREFA_COMPLETA = {
  ...INCLUDE_TAREFA,
  itens: { orderBy: { ordem: 'asc' } },
  eventos: {
    orderBy: { criadoEm: 'desc' },
    take: EVENTOS_NA_RESPOSTA,
    include: { operador: { select: { nome: true } } },
  },
} satisfies Prisma.SeparacaoTarefaInclude

export type TarefaResumo = Prisma.SeparacaoTarefaGetPayload<{ include: typeof INCLUDE_TAREFA }> & {
  progresso: ReturnType<typeof resumoItens>
  empresa: { name: string; code: string } | undefined
}

function empresaDe(companyKey: string) {
  const e = listarEmpresasBling().find(x => x.key === companyKey)
  return e ? { name: e.name, code: e.code } : undefined
}

async function registrarEvento(dados: {
  tarefaId: string; operadorId?: string | null; itemId?: string | null; sku?: string | null
  tipo: SeparacaoEventoTipo; qtd?: number | null; detalhe?: string | null
}) {
  await prisma.separacaoEvento.create({ data: dados })
}

// ---------- sync de NFs → tarefas ----------

let syncEmAndamento = false
let timerSync: NodeJS.Timeout | null = null

export async function sincronizarNfs(): Promise<{ novas: number; canceladas: number; erros: string[]; empresas: string[] }> {
  if (syncEmAndamento) return { novas: 0, canceladas: 0, erros: ['Sync já em andamento'], empresas: [] }
  syncEmAndamento = true
  const resultado = { novas: 0, canceladas: 0, erros: [] as string[], empresas: [] as string[] }

  try {
    const cfg = await getConfig()
    const dataFinal = dataBR()
    const dataInicial = somarDias(dataFinal, -(cfg.diasNfsFila - 1))

    const empresas = listarEmpresasBling().filter(e => MODO_MOCK || e.connected)
    for (const empresa of empresas) {
      try {
        const nfs = await bling.listarNfs(empresa.key, dataInicial, dataFinal)
        resultado.empresas.push(empresa.key)
        if (nfs.length === 0) continue

        const existentes = await prisma.separacaoTarefa.findMany({
          where: { companyKey: empresa.key, blingNfId: { in: nfs.map(n => n.blingNfId) } },
          select: { id: true, blingNfId: true, status: true, chaveAcesso: true },
        })
        const porId = new Map(existentes.map(e => [e.blingNfId, e]))

        for (const nf of nfs) {
          const existente = porId.get(nf.blingNfId)
          if (!existente) {
            if (nf.cancelada) continue
            await prisma.separacaoTarefa.create({
              data: {
                companyKey: empresa.key, blingNfId: nf.blingNfId, nfNumero: normalizarNumeroNf(nf.numero) || nf.numero,
                nfSerie: nf.serie ?? null, chaveAcesso: nf.chaveAcesso ?? null, nfEmitidaEm: nf.emitidaEm ?? null,
                clienteNome: nf.clienteNome || 'Cliente não informado', valorNota: nf.valorNota ?? null, canal: nf.canal ?? null,
              },
            })
            resultado.novas++
            continue
          }
          if (nf.cancelada && existente.status !== SeparacaoStatus.CONCLUIDO && existente.status !== SeparacaoStatus.CANCELADA) {
            await prisma.separacaoTarefa.update({ where: { id: existente.id }, data: { status: SeparacaoStatus.CANCELADA } })
            await registrarEvento({ tarefaId: existente.id, tipo: SeparacaoEventoTipo.CANCELADO, detalhe: 'NF cancelada no Bling' })
            resultado.canceladas++
            continue
          }
          if (!existente.chaveAcesso && nf.chaveAcesso) {
            await prisma.separacaoTarefa.update({ where: { id: existente.id }, data: { chaveAcesso: nf.chaveAcesso } })
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[Separação] Erro no sync de ${empresa.key}:`, msg)
        resultado.erros.push(`${empresa.name}: ${msg}`)
      }
    }
  } finally {
    syncEmAndamento = false
  }

  if (resultado.novas || resultado.canceladas) emitir({ tipo: 'tarefas', motivo: 'sync' })
  return resultado
}

// Sync periódico com intervalo lido da config a cada rodada (mudou na tela → vale na próxima)
export function iniciarSyncPeriodico() {
  const agendar = async () => {
    const cfg = await getConfig().catch(() => null)
    const minutos = cfg?.intervaloSyncMin ?? 3
    timerSync = setTimeout(async () => {
      try {
        const r = await sincronizarNfs()
        if (r.novas || r.canceladas || r.erros.length) console.log(`[Separação] Sync: ${r.novas} nova(s), ${r.canceladas} cancelada(s)${r.erros.length ? ', erros: ' + r.erros.join(' | ') : ''}`)
      } catch (err) {
        console.error('[Separação] Sync falhou:', err)
      }
      agendar()
    }, minutos * 60 * 1000)
  }
  agendar()
  console.log('[Separação] Sync periódico de NFs iniciado')
}

export function pararSyncPeriodico() {
  if (timerSync) clearTimeout(timerSync)
}

// ---------- consultas ----------

export async function listarTarefas(filtro: { status?: SeparacaoStatus[]; companyKey?: string; dias?: number }): Promise<TarefaResumo[]> {
  const where: Prisma.SeparacaoTarefaWhereInput = {}
  if (filtro.status?.length) where.status = { in: filtro.status }
  if (filtro.companyKey) where.companyKey = filtro.companyKey
  if (filtro.dias) {
    // dias=1 → desde a meia-noite de hoje (Brasília); dias=2 → desde ontem; ...
    const desde = meiaNoiteBR(somarDias(dataBR(), -(filtro.dias - 1)))
    where.OR = [{ nfEmitidaEm: { gte: desde } }, { nfEmitidaEm: null, createdAt: { gte: desde } }]
  }

  const tarefas = await prisma.separacaoTarefa.findMany({
    where,
    include: { ...INCLUDE_TAREFA, itens: { select: { qtdEsperada: true, qtdBipada: true, concluidoEm: true } } },
    orderBy: [{ nfEmitidaEm: 'asc' }, { createdAt: 'asc' }],
  })

  return tarefas.map(({ itens, ...t }) => ({ ...t, progresso: resumoItens(itens), empresa: empresaDe(t.companyKey) }))
}

export async function obterTarefa(id: string) {
  const t = await prisma.separacaoTarefa.findUnique({ where: { id }, include: INCLUDE_TAREFA_COMPLETA })
  if (!t) throw new ErroSeparacao(404, 'NAO_ENCONTRADA', 'Tarefa não encontrada')
  return { ...t, progresso: resumoItens(t.itens), empresa: empresaDe(t.companyKey) }
}

// Localiza a tarefa pelo que foi bipado/digitado: chave de acesso (44 dígitos) ou número da NF
export async function localizarPorCodigo(codigo: string, companyKey?: string) {
  const chave = parsearChaveDanfe(codigo)
  const naoDescartadas = { notIn: [SeparacaoStatus.CANCELADA] }

  if (chave) {
    const porChave = await prisma.separacaoTarefa.findFirst({ where: { chaveAcesso: chave.chave }, include: INCLUDE_TAREFA })
    if (porChave) return { tarefas: [porChave] }
    const empresa = listarEmpresasBling().find(e => e.cnpj === chave.cnpjEmitente)
    const tarefas = await prisma.separacaoTarefa.findMany({
      where: { nfNumero: chave.numero, ...(empresa ? { companyKey: empresa.key } : {}), status: naoDescartadas },
      include: INCLUDE_TAREFA, orderBy: { createdAt: 'desc' },
    })
    return { tarefas }
  }

  const numero = normalizarNumeroNf(codigo)
  if (!numero) throw new ErroSeparacao(400, 'CODIGO_INVALIDO', 'Informe o número da NF ou bipe a DANFE')
  const tarefas = await prisma.separacaoTarefa.findMany({
    where: { nfNumero: numero, ...(companyKey ? { companyKey } : {}), status: naoDescartadas },
    include: INCLUDE_TAREFA, orderBy: { createdAt: 'desc' },
  })
  return { tarefas }
}

// ---------- triagem (balcão) ----------

export type AcaoTriagem = 'separar' | 'ignorar' | 'voltar'

const TRANSICOES_TRIAGEM: Record<AcaoTriagem, { de: SeparacaoStatus[]; para: SeparacaoStatus }> = {
  separar: { de: [SeparacaoStatus.AGUARDANDO_TRIAGEM, SeparacaoStatus.IGNORADA], para: SeparacaoStatus.PENDENTE },
  ignorar: { de: [SeparacaoStatus.AGUARDANDO_TRIAGEM, SeparacaoStatus.PENDENTE], para: SeparacaoStatus.IGNORADA },
  // "voltar" também tira uma NF EM_SEPARACAO (supervisor desfaz um início indevido; itens/contagens são descartados)
  voltar:  { de: [SeparacaoStatus.PENDENTE, SeparacaoStatus.IGNORADA, SeparacaoStatus.EM_SEPARACAO], para: SeparacaoStatus.AGUARDANDO_TRIAGEM },
}

export async function triar(ids: string[], acao: AcaoTriagem, operador: OperadorPayload): Promise<number> {
  const regra = TRANSICOES_TRIAGEM[acao]
  if (!regra) throw new ErroSeparacao(400, 'ACAO_INVALIDA', 'Ação de triagem inválida')

  const alvo = await prisma.separacaoTarefa.findMany({ where: { id: { in: ids }, status: { in: regra.de } }, select: { id: true } })
  if (alvo.length === 0) return 0

  const idsAlvo = alvo.map(a => a.id)
  const limparSeparacao = acao === 'voltar'
  await prisma.$transaction([
    ...(limparSeparacao ? [prisma.separacaoItem.deleteMany({ where: { tarefaId: { in: idsAlvo } } })] : []),
    prisma.separacaoTarefa.updateMany({
      where: { id: { in: idsAlvo } },
      data: {
        status: regra.para, triadoPorId: operador.id, triadoEm: new Date(),
        ...(limparSeparacao ? { operadorId: null, iniciadoEm: null, separadoEm: null, itensCarregados: false } : {}),
      },
    }),
    prisma.separacaoEvento.createMany({
      data: alvo.map(a => ({ tarefaId: a.id, operadorId: operador.id, tipo: SeparacaoEventoTipo.TRIAGEM, detalhe: acao })),
    }),
  ])
  emitir({ tipo: 'tarefas', motivo: 'triagem' })
  return alvo.length
}

// ---------- separação (celular) ----------

async function carregarItens(tarefaId: string, companyKey: string, blingNfId: string) {
  const itensNf = await bling.obterItensNf(companyKey, blingNfId)
  const fisicos = await explodirItensNf(bling, companyKey, itensNf)
  if (fisicos.length === 0) throw new ErroSeparacao(422, 'NF_SEM_ITENS', 'A NF não tem itens para separar')

  await prisma.$transaction([
    prisma.separacaoItem.deleteMany({ where: { tarefaId } }),
    prisma.separacaoItem.createMany({
      data: fisicos.map((f, i) => ({
        tarefaId, ordem: i, sku: f.sku, nome: f.nome, fotoUrl: f.fotoUrl ?? null, blingProdutoId: f.blingProdutoId ?? null,
        origemKit: f.origens.length ? f.origens.join(', ') : null, qtdEsperada: f.qtd, pesoUnit: f.pesoUnit ?? null,
      })),
    }),
    prisma.separacaoTarefa.update({ where: { id: tarefaId }, data: { itensCarregados: true } }),
  ])
}

export async function iniciar(tarefaId: string, operador: OperadorPayload) {
  const t = await prisma.separacaoTarefa.findUnique({ where: { id: tarefaId } })
  if (!t) throw new ErroSeparacao(404, 'NAO_ENCONTRADA', 'Tarefa não encontrada')

  if (t.status === SeparacaoStatus.EM_SEPARACAO) {
    if (t.operadorId && t.operadorId !== operador.id && !operador.supervisor) {
      const outro = await prisma.separacaoOperador.findUnique({ where: { id: t.operadorId }, select: { nome: true } })
      throw new ErroSeparacao(409, 'EM_SEPARACAO_POR_OUTRO', `Esta NF já está sendo separada por ${outro?.nome ?? 'outro operador'}`)
    }
  } else if (t.status !== SeparacaoStatus.PENDENTE) {
    throw new ErroSeparacao(409, 'STATUS_INVALIDO', `NF não está liberada para separação (status: ${t.status})`)
  }

  if (!t.itensCarregados) await carregarItens(t.id, t.companyKey, t.blingNfId)

  const trocouOperador = t.operadorId !== operador.id
  await prisma.separacaoTarefa.update({
    where: { id: t.id },
    data: { status: SeparacaoStatus.EM_SEPARACAO, operadorId: operador.id, iniciadoEm: t.iniciadoEm ?? new Date() },
  })
  if (t.status === SeparacaoStatus.PENDENTE || trocouOperador) {
    await registrarEvento({ tarefaId: t.id, operadorId: operador.id, tipo: SeparacaoEventoTipo.INICIO, detalhe: trocouOperador && t.operadorId ? 'assumiu de outro operador' : null })
  }
  emitir({ tipo: 'tarefas', motivo: 'inicio' })
  return obterTarefa(t.id)
}

export interface ResultadoBipe {
  ok: boolean
  motivo?: 'ITEM_NAO_PERTENCE' | 'ITEM_COMPLETO' | 'QTD_DIVERGENTE' | 'QTD_MANUAL_NAO_PERMITIDA'
  mensagem: string
  item?: { id: string; sku: string; nome: string; qtdEsperada: number; qtdBipada: number; concluido: boolean }
  tarefaSeparada: boolean
  progresso: ReturnType<typeof resumoItens>
}

export async function bipar(tarefaId: string, operador: OperadorPayload, codigo: string, qtdManual?: number): Promise<ResultadoBipe> {
  const t = await prisma.separacaoTarefa.findUnique({ where: { id: tarefaId }, include: { itens: true } })
  if (!t) throw new ErroSeparacao(404, 'NAO_ENCONTRADA', 'Tarefa não encontrada')
  if (t.status !== SeparacaoStatus.EM_SEPARACAO) throw new ErroSeparacao(409, 'STATUS_INVALIDO', 'Esta NF não está em separação')
  if (t.operadorId !== operador.id && !operador.supervisor) throw new ErroSeparacao(409, 'EM_SEPARACAO_POR_OUTRO', 'Esta NF está com outro operador')

  const sku = normalizarSku(codigo)
  const progressoAtual = () => resumoItens(t.itens)
  const item = t.itens.find(i => normalizarSku(i.sku) === sku)

  if (!item) {
    await registrarEvento({ tarefaId, operadorId: operador.id, sku: codigo.trim(), tipo: SeparacaoEventoTipo.BIPE_ERRADO, detalhe: 'não pertence à NF' })
    return { ok: false, motivo: 'ITEM_NAO_PERTENCE', mensagem: 'Este item NÃO é desta nota', tarefaSeparada: false, progresso: progressoAtual() }
  }

  const restante = item.qtdEsperada - item.qtdBipada
  if (restante <= 0) {
    await registrarEvento({ tarefaId, operadorId: operador.id, itemId: item.id, sku: item.sku, tipo: SeparacaoEventoTipo.BIPE_EXCEDENTE })
    return {
      ok: false, motivo: 'ITEM_COMPLETO', mensagem: 'Este item já foi separado por completo', tarefaSeparada: false,
      item: { id: item.id, sku: item.sku, nome: item.nome, qtdEsperada: item.qtdEsperada, qtdBipada: item.qtdBipada, concluido: true },
      progresso: progressoAtual(),
    }
  }

  const cfg = await getConfig()
  let novaQtd: number
  let manual = false

  if (qtdManual !== undefined) {
    if (item.qtdEsperada <= cfg.limiteBipeUnitario) {
      return { ok: false, motivo: 'QTD_MANUAL_NAO_PERMITIDA', mensagem: `Até ${cfg.limiteBipeUnitario} unidades, bipe uma a uma`, tarefaSeparada: false, progresso: progressoAtual() }
    }
    if (qtdManual !== restante) {
      await registrarEvento({ tarefaId, operadorId: operador.id, itemId: item.id, sku: item.sku, tipo: SeparacaoEventoTipo.BIPE_ERRADO, qtd: qtdManual, detalhe: `qtd divergente (esperado ${restante})` })
      return { ok: false, motivo: 'QTD_DIVERGENTE', mensagem: `Quantidade informada (${qtdManual}) diferente da esperada (${restante}). Confira e conte de novo.`, tarefaSeparada: false, progresso: progressoAtual() }
    }
    novaQtd = item.qtdEsperada
    manual = true
  } else {
    novaQtd = Math.min(item.qtdBipada + 1, item.qtdEsperada)
  }

  const concluido = novaQtd >= item.qtdEsperada
  const atualizado = await prisma.separacaoItem.update({
    where: { id: item.id },
    data: { qtdBipada: novaQtd, qtdManual: manual || item.qtdManual, concluidoEm: concluido ? new Date() : null },
  })
  await registrarEvento({
    tarefaId, operadorId: operador.id, itemId: item.id, sku: item.sku,
    tipo: manual ? SeparacaoEventoTipo.QTD_MANUAL : SeparacaoEventoTipo.BIPE_OK, qtd: manual ? qtdManual : 1,
  })

  // Recalcula progresso com o item atualizado
  const itensAtualizados = t.itens.map(i => (i.id === atualizado.id ? atualizado : i))
  const progresso = resumoItens(itensAtualizados)

  let tarefaSeparada = false
  if (progresso.completo) {
    await prisma.separacaoTarefa.update({ where: { id: tarefaId }, data: { status: SeparacaoStatus.SEPARADO, separadoEm: new Date() } })
    await registrarEvento({ tarefaId, operadorId: operador.id, tipo: SeparacaoEventoTipo.SEPARADO })
    tarefaSeparada = true
    emitir({ tipo: 'tarefas', motivo: 'separado' })
  }
  emitir({ tipo: 'tarefa', tarefaId, motivo: 'bipe' })

  return {
    ok: true,
    mensagem: concluido ? `${item.sku} completo` : `${item.sku}: ${novaQtd} de ${item.qtdEsperada}`,
    item: { id: item.id, sku: item.sku, nome: item.nome, qtdEsperada: item.qtdEsperada, qtdBipada: novaQtd, concluido },
    tarefaSeparada,
    progresso,
  }
}

// Zera a contagem de um item (operador bipou a mais / pegou errado). Volta a tarefa para EM_SEPARACAO se estava SEPARADO.
export async function zerarItem(tarefaId: string, itemId: string, operador: OperadorPayload) {
  const t = await prisma.separacaoTarefa.findUnique({ where: { id: tarefaId } })
  if (!t) throw new ErroSeparacao(404, 'NAO_ENCONTRADA', 'Tarefa não encontrada')
  if (t.status !== SeparacaoStatus.EM_SEPARACAO && t.status !== SeparacaoStatus.SEPARADO) {
    throw new ErroSeparacao(409, 'STATUS_INVALIDO', 'Só é possível corrigir itens de uma NF em separação')
  }
  if (t.operadorId !== operador.id && !operador.supervisor) throw new ErroSeparacao(409, 'EM_SEPARACAO_POR_OUTRO', 'Esta NF está com outro operador')

  const item = await prisma.separacaoItem.findFirst({ where: { id: itemId, tarefaId } })
  if (!item) throw new ErroSeparacao(404, 'ITEM_NAO_ENCONTRADO', 'Item não encontrado')

  await prisma.separacaoItem.update({ where: { id: item.id }, data: { qtdBipada: 0, qtdManual: false, concluidoEm: null, pesoLido: null, pesoOk: null } })
  await registrarEvento({ tarefaId, operadorId: operador.id, itemId: item.id, sku: item.sku, tipo: SeparacaoEventoTipo.REABERTO, detalhe: 'contagem zerada' })
  if (t.status === SeparacaoStatus.SEPARADO) {
    await prisma.separacaoTarefa.update({ where: { id: tarefaId }, data: { status: SeparacaoStatus.EM_SEPARACAO, separadoEm: null } })
    emitir({ tipo: 'tarefas', motivo: 'reaberto' })
  }
  emitir({ tipo: 'tarefa', tarefaId, motivo: 'zerar' })
  return obterTarefa(tarefaId)
}

// ---------- balcão: finalizar / reabrir / peso ----------

export async function finalizar(tarefaId: string, supervisor: OperadorPayload, opcoes: { liberar?: boolean; motivo?: string } = {}) {
  const t = await prisma.separacaoTarefa.findUnique({ where: { id: tarefaId }, include: { itens: true } })
  if (!t) throw new ErroSeparacao(404, 'NAO_ENCONTRADA', 'Tarefa não encontrada')
  if (t.status !== SeparacaoStatus.SEPARADO) throw new ErroSeparacao(409, 'STATUS_INVALIDO', 'A NF precisa estar SEPARADA para finalizar')

  const cfg = await getConfig()
  if (cfg.balancaAtiva) {
    const pendentesPeso = t.itens.filter(i => i.qtdManual && i.pesoOk !== true)
    if (pendentesPeso.length > 0) {
      if (!opcoes.liberar) {
        throw new ErroSeparacao(409, 'PESO_PENDENTE', `${pendentesPeso.length} item(ns) com quantidade digitada ainda sem conferência de peso`)
      }
      await registrarEvento({ tarefaId, operadorId: supervisor.id, tipo: SeparacaoEventoTipo.LIBERACAO, detalhe: opcoes.motivo || 'liberado sem conferência de peso' })
    }
  }

  await prisma.separacaoTarefa.update({
    where: { id: tarefaId },
    data: { status: SeparacaoStatus.CONCLUIDO, finalizadoPorId: supervisor.id, concluidoEm: new Date() },
  })
  await registrarEvento({ tarefaId, operadorId: supervisor.id, tipo: SeparacaoEventoTipo.FINALIZADO })
  emitir({ tipo: 'tarefas', motivo: 'finalizado' })
  return obterTarefa(tarefaId)
}

export async function reabrir(tarefaId: string, supervisor: OperadorPayload, motivo?: string) {
  const t = await prisma.separacaoTarefa.findUnique({ where: { id: tarefaId } })
  if (!t) throw new ErroSeparacao(404, 'NAO_ENCONTRADA', 'Tarefa não encontrada')
  if (t.status !== SeparacaoStatus.SEPARADO && t.status !== SeparacaoStatus.CONCLUIDO) {
    throw new ErroSeparacao(409, 'STATUS_INVALIDO', 'Só é possível reabrir NF separada ou concluída')
  }
  await prisma.separacaoTarefa.update({
    where: { id: tarefaId },
    data: { status: SeparacaoStatus.EM_SEPARACAO, separadoEm: null, concluidoEm: null, finalizadoPorId: null },
  })
  await registrarEvento({ tarefaId, operadorId: supervisor.id, tipo: SeparacaoEventoTipo.REABERTO, detalhe: motivo || null })
  emitir({ tipo: 'tarefas', motivo: 'reaberto' })
  return obterTarefa(tarefaId)
}

// Conferência de peso de um item no balcão (fase 4b — só faz sentido com balancaAtiva)
export async function registrarPesoItem(tarefaId: string, itemId: string, pesoLido: number, operador: OperadorPayload) {
  const item = await prisma.separacaoItem.findFirst({ where: { id: itemId, tarefaId } })
  if (!item) throw new ErroSeparacao(404, 'ITEM_NAO_ENCONTRADO', 'Item não encontrado')
  if (!Number.isFinite(pesoLido) || pesoLido < 0) throw new ErroSeparacao(400, 'PESO_INVALIDO', 'Peso inválido')

  const cfg = await getConfig()
  let pesoOk: boolean | null = null
  let detalhe = 'sem peso cadastrado no Bling'
  if (item.pesoUnit && item.pesoUnit > 0) {
    const esperado = item.pesoUnit * item.qtdEsperada
    const desvioPct = Math.abs(pesoLido - esperado) / esperado * 100
    pesoOk = desvioPct <= cfg.toleranciaPesoPct
    detalhe = `lido ${pesoLido.toFixed(3)} kg, esperado ${esperado.toFixed(3)} kg (${desvioPct.toFixed(1)}%)`
  }

  const atualizado = await prisma.separacaoItem.update({ where: { id: item.id }, data: { pesoLido, pesoOk } })
  await registrarEvento({
    tarefaId, operadorId: operador.id, itemId: item.id, sku: item.sku,
    tipo: pesoOk === false ? SeparacaoEventoTipo.PESO_FORA : SeparacaoEventoTipo.PESO_OK, qtd: pesoLido, detalhe,
  })
  emitir({ tipo: 'tarefa', tarefaId, motivo: 'peso' })
  return { item: atualizado, pesoOk, detalhe }
}
