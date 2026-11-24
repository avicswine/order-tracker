/**
 * Nota da venda do Mercado Livre nas vendas "combinar entrega" (a nossa transportadora leva).
 *
 * O José escrevia à mão na venda do ML "Previsão de entrega: 03/12/2026", para saber pela
 * lista do ML quais já tinham sido combinadas. Agora, a cada rodada de rastreio, o
 * order-tracker atualiza essa nota sozinho (decisão do José, 24/11/2026: sem botão).
 *
 * Economia de chamadas (a conta do ML já foi bloqueada): guarda em `mlNotaTexto` o último
 * texto gravado e só chama o ML quando o texto muda.
 */
import { prisma } from '../lib/prisma'
import { mlGravarNota, ML_COMPANIES, type MlCompany } from './mercadolivre'

/** entregue há até estes dias ainda atualiza a nota (para virar "Entregue em …") */
const DIAS_APOS_ENTREGA = 7
/** pausa entre duas notas seguidas */
const PAUSA_ENTRE_NOTAS_MS = 400
/**
 * Máximo de notas gravadas por rodada (variável ML_NOTAS_POR_RODADA no Railway).
 * Padrão 1: na primeira vez o José confere uma nota no ML antes de liberar o resto.
 */
function limitePorRodada(): number {
  const n = Number(process.env.ML_NOTAS_POR_RODADA ?? 1)
  return Number.isInteger(n) && n > 0 ? n : 1
}

/** O status do pedido em português — a nota é lida por gente, não por máquina. */
const STATUS_EM_PORTUGUES: Record<string, string> = {
  PENDING: 'Não enviada',       // termo escolhido pelo José (24/11/2026)
  IN_TRANSIT: 'Em trânsito',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
}

/**
 * O texto da nota. Ordem pedida pelo José (24/11/2026): NF, transportadora, status e entrega.
 * Ex.: "NF 014373 · EXPRESSO SAO MIGUEL S/A · Em trânsito · Entrega 03/12/2026"
 * Cada parte só entra se existir.
 */
export function notaDaVenda(v: {
  status?: string | null; estimatedDelivery?: Date | null
  deliveredAt?: Date | null; nfNumber?: string | null
  carrier?: { name: string } | null
}): string {
  const partes: string[] = []
  if (v.nfNumber) partes.push(`NF ${v.nfNumber}`)
  if (v.carrier?.name) partes.push(v.carrier.name)
  // fuso fixo: o texto sai igual no Railway (UTC) e num script rodado no PC (-03).
  // deliveredAt é o instante real da entrega (dia de Brasília); estimatedDelivery é um dia
  // gravado à meia-noite UTC pelo rastreio, então se lê em UTC para não cair no dia anterior
  if (v.deliveredAt) {
    partes.push(`Entregue em ${v.deliveredAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`)
  } else {
    if (v.status) partes.push(STATUS_EM_PORTUGUES[v.status] ?? v.status)
    if (v.estimatedDelivery) {
      partes.push(`Entrega ${v.estimatedDelivery.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`)
    }
  }
  return partes.join(' · ')
}

/** Vendas "combinar entrega" cuja nota no ML está diferente do texto de agora. Só lê o banco. */
export async function notasParaAtualizar(): Promise<{ id: string; orderNumber: string; mlOrderId: string; mlCompany: MlCompany; nota: string }[]> {
  const desde = new Date(Date.now() - DIAS_APOS_ENTREGA * 86400000)
  const vendas = await prisma.order.findMany({
    where: {
      mlSemEnvio: true,
      mlOrderId: { not: null },
      mlCompany: { in: ML_COMPANIES },
      nfNumber: { not: null },
      OR: [{ status: { in: ['PENDING', 'IN_TRANSIT'] } }, { status: 'DELIVERED', deliveredAt: { gte: desde } }],
    },
    select: {
      id: true, orderNumber: true, mlOrderId: true, mlCompany: true, mlNotaTexto: true,
      nfNumber: true, status: true, estimatedDelivery: true, deliveredAt: true,
      carrier: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return vendas
    .map((v) => ({ id: v.id, orderNumber: v.orderNumber, mlOrderId: v.mlOrderId!, mlCompany: v.mlCompany as MlCompany, nota: notaDaVenda(v), anterior: v.mlNotaTexto }))
    .filter((v) => v.nota && v.nota !== v.anterior)
    .map(({ anterior: _anterior, ...v }) => v)
}

/**
 * Atualiza no ML as notas que mudaram, até o limite da rodada. Chamada no fim de cada
 * rodada de rastreio. Erro numa venda fica no log e não para as outras nem o rastreio.
 */
export async function sincronizarNotasCombinar(): Promise<void> {
  const pendentes = await notasParaAtualizar()
  if (!pendentes.length) return
  const lote = pendentes.slice(0, limitePorRodada())
  for (const v of lote) {
    const r = await mlGravarNota(v.mlCompany, v.mlOrderId, v.nota)
    // 'mantida' (nota escrita à mão ou já igual) também conta como feita: não tenta de novo a cada rodada
    if (r !== 'falhou') await prisma.order.update({ where: { id: v.id }, data: { mlNotaTexto: v.nota } })
    console.log(`[NotasML] ${v.orderNumber}: nota ${r} — "${v.nota}"`)
    await new Promise((ok) => setTimeout(ok, PAUSA_ENTRE_NOTAS_MS))
  }
  if (pendentes.length > lote.length) {
    console.log(`[NotasML] ${pendentes.length - lote.length} nota(s) ficam para as próximas rodadas (limite ${lote.length} por rodada)`)
  }
}
