/**
 * Análise geral de datas de todos os pedidos ativos
 * railway run node backend/review-dates.mjs
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

function isWeekend(date) {
  const d = date.getDay()
  return d === 0 || d === 6
}

function daysBetween(a, b) {
  return Math.round((b - a) / (1000 * 60 * 60 * 24))
}

const orders = await prisma.order.findMany({
  where: { status: { in: ['PENDING', 'IN_TRANSIT'] } },
  select: {
    id: true, orderNumber: true, status: true,
    shippedAt: true, estimatedDelivery: true, createdAt: true,
    lastTracking: true, lastTrackingAt: true,
    carrier: { select: { name: true, trackingSystem: true } },
  },
  orderBy: { orderNumber: 'asc' },
})

const hoje = new Date('2026-03-14')
const problemas = []

for (const o of orders) {
  const issues = []

  if (o.shippedAt) {
    // Enviado no fim de semana
    if (isWeekend(o.shippedAt)) issues.push(`enviado ${o.shippedAt.toLocaleDateString('pt-BR')} (fim de semana)`)
    // Enviado no futuro
    if (o.shippedAt > hoje) issues.push(`enviado no futuro: ${o.shippedAt.toLocaleDateString('pt-BR')}`)
    // Enviado depois da criação no sistema (mais de 7 dias)
    if (daysBetween(o.createdAt, o.shippedAt) > 7) issues.push(`enviado ${daysBetween(o.createdAt, o.shippedAt)}d após importação`)
  }

  if (o.estimatedDelivery) {
    // Previsão no passado (mais de 1 dia atrás) e não entregue
    if (o.estimatedDelivery < new Date('2026-03-13')) issues.push(`previsão vencida: ${o.estimatedDelivery.toLocaleDateString('pt-BR')}`)
  }

  // Sem data de envio
  if (!o.shippedAt && o.carrier?.trackingSystem !== 'NONE') {
    issues.push('sem data de envio')
  }

  if (issues.length > 0) {
    problemas.push({ order: o, issues })
  }
}

console.log(`Total ativos: ${orders.length} | Com problemas: ${problemas.length}\n`)

// Agrupa por tipo de problema
const enviadoFimDeSemana = problemas.filter(p => p.issues.some(i => i.includes('fim de semana')))
const semDataEnvio = problemas.filter(p => p.issues.some(i => i.includes('sem data de envio')))
const previsaoVencida = problemas.filter(p => p.issues.some(i => i.includes('previsão vencida')))

console.log(`=== ENVIADOS EM FIM DE SEMANA (${enviadoFimDeSemana.length}) ===`)
enviadoFimDeSemana.forEach(p => console.log(`  ${p.order.orderNumber} | ${p.order.carrier?.name} | enviado: ${p.order.shippedAt?.toLocaleDateString('pt-BR')}`))

console.log(`\n=== SEM DATA DE ENVIO (${semDataEnvio.length}) ===`)
semDataEnvio.slice(0, 20).forEach(p => console.log(`  ${p.order.orderNumber} | ${p.order.carrier?.name ?? 'sem carrier'} | último rastreio: ${p.order.lastTracking ?? 'nenhum'}`))
if (semDataEnvio.length > 20) console.log(`  ... e mais ${semDataEnvio.length - 20}`)

console.log(`\n=== PREVISÃO VENCIDA SEM ENTREGA (${previsaoVencida.length}) ===`)
previsaoVencida.slice(0, 20).forEach(p => console.log(`  ${p.order.orderNumber} | ${p.order.carrier?.name} | previsão: ${p.order.estimatedDelivery?.toLocaleDateString('pt-BR')}`))
if (previsaoVencida.length > 20) console.log(`  ... e mais ${previsaoVencida.length - 20}`)

await prisma.$disconnect()
