import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const total = await prisma.order.count()
const avic = await prisma.order.count({ where: { senderCnpj: { contains: '47715256' } } })
const agro = await prisma.order.count({ where: { senderCnpj: { contains: '54695386' } } })
const equi = await prisma.order.count({ where: { senderCnpj: { contains: '56633474' } } })

console.log(`Total: ${total} | AVIC: ${avic} | AGRO: ${agro} | EQUI: ${equi}`)
console.log('DATABASE_URL começa com:', process.env.DATABASE_URL?.substring(0, 30))

await prisma.$disconnect()
