import { PrismaClient, OrderStatus } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  const carriers = await Promise.all([
    prisma.carrier.upsert({
      where: { cnpj: '12.345.678/0001-90' },
      update: {},
      create: { name: 'Correios', cnpj: '12.345.678/0001-90', phone: '(11) 3003-0100', active: true },
    }),
    prisma.carrier.upsert({
      where: { cnpj: '98.765.432/0001-10' },
      update: {},
      create: { name: 'Jadlog', cnpj: '98.765.432/0001-10', phone: '(11) 3131-0800', active: true },
    }),
    prisma.carrier.upsert({
      where: { cnpj: '11.222.333/0001-44' },
      update: {},
      create: { name: 'Sequoia', cnpj: '11.222.333/0001-44', phone: '(11) 4020-1000', active: false },
    }),
  ])

  const statuses: OrderStatus[] = [
    OrderStatus.PENDING,
    OrderStatus.IN_TRANSIT,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ]

  const customers = [
    'Ana Silva', 'Bruno Oliveira', 'Carla Souza', 'Diego Santos',
    'Elena Costa', 'Fabio Lima', 'Gabriela Alves', 'Henrique Rocha',
  ]

  for (let i = 1; i <= 20; i++) {
    const status = statuses[i % statuses.length]
    const carrierId = carriers[i % carriers.length].id
    const customer = customers[i % customers.length]

    const order = await prisma.order.upsert({
      where: { orderNumber: `PED-${String(i).padStart(4, '0')}` },
      update: {},
      create: {
        orderNumber: `PED-${String(i).padStart(4, '0')}`,
        customerName: customer,
        customerEmail: `${customer.toLowerCase().replace(' ', '.')}@email.com`,
        carrierId,
        status,
        shippedAt: status !== OrderStatus.PENDING ? new Date(Date.now() - i * 86400000) : null,
        estimatedDelivery: new Date(Date.now() + (5 - (i % 5)) * 86400000),
        deliveredAt: status === OrderStatus.DELIVERED ? new Date(Date.now() - 86400000) : null,
        statusHistory: {
          create: [
            { status: OrderStatus.PENDING, note: 'Order created', createdAt: new Date(Date.now() - (i + 2) * 86400000) },
            ...(status !== OrderStatus.PENDING
              ? [{ status, note: `Status updated to ${status}`, createdAt: new Date(Date.now() - i * 86400000) }]
              : []),
          ],
        },
      },
    })
    console.log(`Created order ${order.orderNumber}`)
  }

  console.log('Seeding complete!')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
