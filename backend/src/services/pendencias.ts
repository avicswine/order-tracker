import { prisma } from '../lib/prisma'
import { PendenciaTipo, PendenciaOrigem, OrderStatus } from '@prisma/client'

// Cria pendência automática a partir do rastreamento (ocorrência/atraso).
// Dedup: não cria se já existe pendência não-resolvida do mesmo pedido e tipo.
export async function criarPendenciaAuto(order: {
  id: string
  nfNumber: string | null
  customerName: string
  senderCnpj: string | null
  lastTracking: string | null
}, tipo: PendenciaTipo): Promise<boolean> {
  const existente = await prisma.pendencia.findFirst({
    where: { orderId: order.id, tipo, status: { not: 'RESOLVIDA' } },
  })
  if (existente) return false

  await prisma.pendencia.create({
    data: {
      orderId: order.id,
      nfNumber: order.nfNumber,
      customerName: order.customerName,
      // Sempre só dígitos — a tabela orders guarda formatado (47.715.256/0001-49)
      senderCnpj: order.senderCnpj?.replace(/\D/g, '') ?? null,
      tipo,
      origem: PendenciaOrigem.AUTO,
      descricao: order.lastTracking ?? null,
    },
  })
  console.log(`[Pendencias] Criada automática (${tipo}) para pedido ${order.nfNumber ?? order.id}`)
  return true
}

// Resolve automaticamente pendências de rastreio quando o pedido é entregue.
// Só toca nas de origem AUTO dos tipos ATRASO/OCORRENCIA — as manuais (defeito etc.) ficam.
export async function resolverPendenciasAutoSeEntregue(orderId: string, status: OrderStatus): Promise<void> {
  if (status !== OrderStatus.DELIVERED) return
  const { count } = await prisma.pendencia.updateMany({
    where: {
      orderId,
      origem: PendenciaOrigem.AUTO,
      tipo: { in: [PendenciaTipo.ATRASO, PendenciaTipo.OCORRENCIA] },
      status: { not: 'RESOLVIDA' },
    },
    data: { status: 'RESOLVIDA', resolvedAt: new Date() },
  })
  if (count > 0) console.log(`[Pendencias] ${count} pendência(s) de rastreio resolvida(s) — pedido entregue`)
}

// Rede de segurança: varre as pendências automáticas cujo pedido JÁ consta entregue.
// A resolução acima só acontece no instante do sync em que o pedido muda de status
// (e dentro da janela de recência) — se passar batido, a pendência ficaria aberta.
export async function reconciliarPendenciasEntregues(): Promise<number> {
  const pendentes = await prisma.pendencia.findMany({
    where: {
      origem: PendenciaOrigem.AUTO,
      tipo: { in: [PendenciaTipo.ATRASO, PendenciaTipo.OCORRENCIA] },
      status: { not: 'RESOLVIDA' },
      order: { status: OrderStatus.DELIVERED },
    },
    select: { id: true, order: { select: { deliveredAt: true } } },
  })
  if (pendentes.length === 0) return 0

  const ids = pendentes.map((p) => p.id)
  await prisma.pendencia.updateMany({
    where: { id: { in: ids } },
    data: { status: 'RESOLVIDA', resolvedAt: new Date() },
  })
  await prisma.pendenciaNota.createMany({
    data: pendentes.map((p) => ({
      pendenciaId: p.id,
      texto: `✅ Pedido entregue${p.order?.deliveredAt ? ` em ${p.order.deliveredAt.toLocaleDateString('pt-BR')}` : ''} — resolvida automaticamente`,
      autor: 'Sistema',
    })),
  })
  console.log(`[Pendencias] ${ids.length} pendência(s) resolvida(s) — pedido já entregue`)
  return ids.length
}
