import { prisma } from '../../lib/prisma'
import { dataBR, meiaNoiteBR, somarDias } from './datas'

// Etiquetas QR de prateleira "do dia": SKUs físicos que apareceram nos itens das NFs recentes
// e ainda não tiveram etiqueta impressa (tabela separacao_etiquetas). Assim a prateleira vai sendo
// alimentada conforme as NFs chegam, sem precisar varrer o catálogo inteiro.

export interface EtiquetaPendente {
  sku: string
  nome: string
  fotoUrl: string | null
  nfs: number           // em quantas NFs do período apareceu
  unidades: number      // total de unidades no período
  impressoEm: string | null
}

export async function listarSkusDoPeriodo(companyKey: string, dias: number, incluirImpressos: boolean): Promise<EtiquetaPendente[]> {
  const desde = meiaNoiteBR(somarDias(dataBR(), -(dias - 1)))
  const itens = await prisma.separacaoItem.findMany({
    where: {
      tarefa: {
        companyKey,
        status: { not: 'CANCELADA' },
        OR: [{ nfEmitidaEm: { gte: desde } }, { nfEmitidaEm: null, createdAt: { gte: desde } }],
      },
    },
    select: { sku: true, nome: true, fotoUrl: true, qtdEsperada: true, tarefaId: true },
  })

  const porSku = new Map<string, EtiquetaPendente & { tarefas: Set<string> }>()
  for (const it of itens) {
    const chave = it.sku.trim().toLowerCase()
    let e = porSku.get(chave)
    if (!e) {
      e = { sku: it.sku, nome: it.nome, fotoUrl: it.fotoUrl, nfs: 0, unidades: 0, impressoEm: null, tarefas: new Set() }
      porSku.set(chave, e)
    }
    e.tarefas.add(it.tarefaId)
    e.unidades += it.qtdEsperada
    e.fotoUrl ||= it.fotoUrl
  }

  const impressas = await prisma.separacaoEtiqueta.findMany({ where: { companyKey }, select: { sku: true, impressoEm: true } })
  const impressaPorSku = new Map(impressas.map(i => [i.sku.trim().toLowerCase(), i.impressoEm]))

  const lista: EtiquetaPendente[] = []
  for (const [chave, e] of porSku) {
    const impressoEm = impressaPorSku.get(chave) ?? null
    if (impressoEm && !incluirImpressos) continue
    lista.push({ sku: e.sku, nome: e.nome, fotoUrl: e.fotoUrl, nfs: e.tarefas.size, unidades: e.unidades, impressoEm: impressoEm ? impressoEm.toISOString() : null })
  }
  return lista.sort((a, b) => b.nfs - a.nfs || a.sku.localeCompare(b.sku))
}

// SKUs físicos de UMA NF (para imprimir as etiquetas dela direto da tela de separação/conferência)
export async function listarSkusDaTarefa(tarefaId: string): Promise<{ companyKey: string; nfNumero: string; itens: EtiquetaPendente[] }> {
  const tarefa = await prisma.separacaoTarefa.findUnique({
    where: { id: tarefaId },
    select: { companyKey: true, nfNumero: true, itens: { select: { sku: true, nome: true, fotoUrl: true, qtdEsperada: true }, orderBy: { ordem: 'asc' } } },
  })
  if (!tarefa) throw new Error('Tarefa não encontrada')
  const skus = [...new Set(tarefa.itens.map(i => i.sku))]
  const impressas = await prisma.separacaoEtiqueta.findMany({ where: { companyKey: tarefa.companyKey, sku: { in: skus } }, select: { sku: true, impressoEm: true } })
  const impressaPorSku = new Map(impressas.map(i => [i.sku.trim().toLowerCase(), i.impressoEm]))
  const itens: EtiquetaPendente[] = tarefa.itens.map(i => {
    const imp = impressaPorSku.get(i.sku.trim().toLowerCase()) ?? null
    return { sku: i.sku, nome: i.nome, fotoUrl: i.fotoUrl, nfs: 1, unidades: i.qtdEsperada, impressoEm: imp ? imp.toISOString() : null }
  })
  return { companyKey: tarefa.companyKey, nfNumero: tarefa.nfNumero, itens }
}

// SKUs físicos de VÁRIAS NFs (imprimir de uma vez as etiquetas das NFs selecionadas na triagem).
// Agrupa por SKU somando as unidades e contando em quantas NFs aparece.
export async function listarSkusDeTarefas(tarefaIds: string[]): Promise<{ companyKeys: string[]; nfs: string[]; itens: EtiquetaPendente[] }> {
  const tarefas = await prisma.separacaoTarefa.findMany({
    where: { id: { in: tarefaIds } },
    select: { id: true, companyKey: true, nfNumero: true, itens: { select: { sku: true, nome: true, fotoUrl: true, qtdEsperada: true } } },
  })
  if (tarefas.length === 0) return { companyKeys: [], nfs: [], itens: [] }

  const porSku = new Map<string, EtiquetaPendente & { tarefas: Set<string> }>()
  for (const t of tarefas) {
    for (const i of t.itens) {
      const chave = i.sku.trim().toLowerCase()
      let e = porSku.get(chave)
      if (!e) {
        e = { sku: i.sku, nome: i.nome, fotoUrl: i.fotoUrl, nfs: 0, unidades: 0, impressoEm: null, tarefas: new Set() }
        porSku.set(chave, e)
      }
      e.tarefas.add(t.id)
      e.unidades += i.qtdEsperada
      e.fotoUrl ||= i.fotoUrl
    }
  }

  const companyKeys = [...new Set(tarefas.map(t => t.companyKey))]
  const impressas = await prisma.separacaoEtiqueta.findMany({
    where: { companyKey: { in: companyKeys }, sku: { in: [...porSku.values()].map(e => e.sku) } },
    select: { sku: true, impressoEm: true },
  })
  const impressaPorSku = new Map(impressas.map(i => [i.sku.trim().toLowerCase(), i.impressoEm]))

  const itens = [...porSku.entries()].map(([chave, e]) => {
    const imp = impressaPorSku.get(chave) ?? null
    return { sku: e.sku, nome: e.nome, fotoUrl: e.fotoUrl, nfs: e.tarefas.size, unidades: e.unidades, impressoEm: imp ? imp.toISOString() : null }
  }).sort((a, b) => b.nfs - a.nfs || a.sku.localeCompare(b.sku))

  return { companyKeys, nfs: tarefas.map(t => t.nfNumero), itens }
}

export async function marcarImpressas(companyKey: string, skus: string[], operadorId: string): Promise<number> {
  const unicos = [...new Set(skus.map(s => s.trim()).filter(Boolean))]
  let n = 0
  for (const sku of unicos) {
    await prisma.separacaoEtiqueta.upsert({
      where: { companyKey_sku: { companyKey, sku } },
      update: { impressoEm: new Date(), impressoPorId: operadorId },
      create: { companyKey, sku, impressoPorId: operadorId },
    })
    n++
  }
  return n
}

export async function desmarcarImpressas(companyKey: string, skus: string[]): Promise<number> {
  const r = await prisma.separacaoEtiqueta.deleteMany({ where: { companyKey, sku: { in: skus } } })
  return r.count
}

// Zera o histórico de etiquetas impressas — usado quando a etiquetagem começa de verdade
// (durante os testes, SKUs foram marcados como impressos sem que a etiqueta fosse colada).
export async function limparRegistroImpressas(companyKey?: string): Promise<number> {
  const r = await prisma.separacaoEtiqueta.deleteMany({ where: companyKey ? { companyKey } : {} })
  return r.count
}

export async function contarImpressas(): Promise<{ companyKey: string; total: number }[]> {
  const grupos = await prisma.separacaoEtiqueta.groupBy({ by: ['companyKey'], _count: { _all: true } })
  return grupos.map(g => ({ companyKey: g.companyKey, total: g._count._all }))
}
