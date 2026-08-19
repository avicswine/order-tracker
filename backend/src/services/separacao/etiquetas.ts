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
