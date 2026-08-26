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
