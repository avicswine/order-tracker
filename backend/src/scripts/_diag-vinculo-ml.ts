/**
 * Quantos pedidos de venda do ML não têm como achar a conversa?
 * Só leitura. Não imprime nome, CPF, endereço nem telefone de ninguém.
 */
import { prisma } from '../lib/prisma'

async function main(): Promise<void> {
  const comMlCompany = await prisma.order.count({ where: { mlCompany: { not: null } } })
  const semOrderId = await prisma.order.count({
    where: { mlCompany: { not: null }, mlOrderId: null },
  })
  const comOrderId = await prisma.order.count({
    where: { mlCompany: { not: null }, mlOrderId: { not: null } },
  })
  const mkt = await prisma.order.count({ where: { mlOrderId: { startsWith: 'MKT-' } } })
  const mktComCompany = await prisma.order.count({
    where: { mlOrderId: { startsWith: 'MKT-' }, mlCompany: { not: null } },
  })
  const total = await prisma.order.count()

  console.log(`pedidos no total: ${total}`)
  console.log(`de venda do ML (mlCompany preenchido): ${comMlCompany}`)
  console.log(`  com mlOrderId (acham a conversa): ${comOrderId}`)
  console.log(`  SEM mlOrderId (não acham):        ${semOrderId}`)
  console.log(`com mlOrderId "MKT-" (outro marketplace): ${mkt}`)
  console.log(`  destes, com mlCompany preenchido (seria ruim): ${mktComCompany}`)

  // dos que têm vínculo, quantos têm rastreamento para mandar?
  const comRastreio = await prisma.order.count({
    where: { mlCompany: { not: null }, mlOrderId: { not: null }, lastTracking: { not: null } },
  })
  console.log(`\nvenda do ML + vínculo + algum rastreamento: ${comRastreio}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
