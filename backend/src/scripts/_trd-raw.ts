import axios from 'axios'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  const order = await prisma.order.findFirst({
    where: { nfNumber: '009330', carrier: { name: { contains: 'TRD' } } },
    include: { carrier: true }
  })
  if (!order) { console.log('Não encontrado'); return }
  const cnpj = order.senderCnpj!.replace(/\D/g, '')
  const nf = String(parseInt(order.nfNumber!, 10))
  const tenant = order.carrier!.trackingIdentifier!
  const response = await axios.post(
    'https://platform.senior.com.br/t/senior.com.br/bridge/1.0/anonymous/rest/tms/tck/actions/externalTenantConsultaTracking',
    { inscricaoFiscal: cnpj, documento: nf },
    { headers: { 'Content-Type': 'application/json', 'X-Tenant': tenant, 'X-TenantDomain': `${tenant}.senior.com.br` }, timeout: 15000 }
  )
  const rawList = response.data.listaTracking
  const firstItem = rawList[0]
  const tracking = firstItem.tracking
  console.log('dataPrevisaoEntrega raw:', JSON.stringify(tracking.dataPrevisaoEntrega))
  console.log('dataPrevisaoEntrega type:', typeof tracking.dataPrevisaoEntrega)
  await prisma.$disconnect()
}
main().catch(console.error)
