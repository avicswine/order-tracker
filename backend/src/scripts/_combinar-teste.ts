/** Teste SÓ LEITURA do "combinar entrega": confere o feedback da venda de exemplo e
 *  lista pedidos entregues que ainda não têm vínculo com o ML. Não escreve nada. */
import axios from 'axios'
import { prisma } from '../lib/prisma'
import { mlAuth } from '../services/mercadolivre'
import { cnpjVariantes } from '../services/mlEnvios'

const ML_API = 'https://api.mercadolibre.com'

async function main() {
  const auth = await mlAuth('avic')
  if (!auth) throw new Error('conta AVIC não autorizada')

  const oid = '2000018261088844'
  const { data: order } = await axios.get(`${ML_API}/orders/${oid}`, auth.H)
  const { data: fb } = await axios.get(`${ML_API}/orders/${oid}/feedback`, auth.H)
  console.log(`venda ${oid}: tags=${JSON.stringify(order.tags)} shipping=${JSON.stringify(order.shipping)}`)
  console.log(`feedback do vendedor: fulfilled=${fb?.sale?.fulfilled} rating=${fb?.sale?.rating} em ${fb?.sale?.date_created}`)
  console.log(fb?.sale?.fulfilled ? '→ já informado: o app NÃO avisaria de novo ✓' : '→ o app avisaria a entrega')

  const entregues = await prisma.order.count({
    where: { status: 'DELIVERED', nfNumber: { not: null }, mlShipmentId: null, mlSemEnvio: false,
             nfIssuedAt: { gte: new Date(Date.now() - 60 * 86400_000) } },
  })
  const jaVinculados = await prisma.order.count({ where: { mlSemEnvio: true } })
  console.log(`\npedidos entregues (60 dias) ainda sem vínculo ML: ${entregues}`)
  console.log(`pedidos já marcados como "combinar entrega": ${jaVinculados}`)
  const cnpjs = { avic: cnpjVariantes('avic').length, agro: cnpjVariantes('agro').length }
  console.log('variantes de CNPJ por conta:', cnpjs)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
