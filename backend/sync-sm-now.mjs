/**
 * Sync completo São Miguel — salva no banco com logs detalhados
 * railway run node backend/sync-sm-now.mjs
 */
import { PrismaClient } from '@prisma/client'
import { createCipheriv, createHash, randomBytes } from 'crypto'

const prisma = new PrismaClient()
const SM_APP_KEY = 'Sx8AHhuIpDZYfY5GlzOzrlG1fYlhl4HD'
const SM_API_URL = process.env.SM_PROXY_URL || 'https://srv.expressosaomiguel.com.br:40490/api-portal-cliente/tracks'

console.log('SM_PROXY_URL:', SM_API_URL, '\n')

function smCreateToken() {
  const payload = JSON.stringify({ message: 'esm_decripter', expired_in: new Date(Date.now() + 5 * 60 * 1000).toISOString() })
  const salt = randomBytes(8)
  let derived = Buffer.alloc(0), block = Buffer.alloc(0)
  while (derived.length < 48) {
    const h = createHash('md5'); h.update(block); h.update(Buffer.from(SM_APP_KEY, 'utf8')); h.update(salt)
    block = h.digest(); derived = Buffer.concat([derived, block])
  }
  const key = derived.subarray(0, 32), iv = derived.subarray(32, 48)
  const c = createCipheriv('aes-256-cbc', key, iv)
  const enc = Buffer.concat([c.update(payload, 'utf8'), c.final()])
  return Buffer.concat([Buffer.from('Salted__'), salt, enc]).toString('base64')
}

function mapStatus(text) {
  const t = text.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (t.includes('ENTREGUE') || t.includes('ENTREGA REALIZADA') || t.includes('OCORRENCIA DE ENTREGA')) return 'DELIVERED'
  if (t.includes('DEVOLV') || t.includes('RETORNO') || t.includes('CANCELAD')) return 'CANCELLED'
  if (t.includes('SAIU PARA ENTREGA') || t.includes('EM ROTA') || t.includes('EM TRANSITO') ||
      t.includes('TRANSFERENCIA') || t.includes('COLETADO') || t.includes('EXPEDIDO') ||
      t.includes('CHEGADA') || t.includes('RECEBIDO') || t.includes('AGUARDANDO') ||
      t.includes('CONHECIMENTO') || t.includes('EMISSAO') || t.includes('VIAGEM')) return 'IN_TRANSIT'
  return null
}

function smMapStatus(control, title) {
  const c = (control ?? '').toUpperCase()
  if (c === 'ENTREGA' || c === 'ENTREGUE') return 'DELIVERED'
  if (['SAIU_ENTREGA','EM_EMTREGA','LOCAL_ENTREGA','CENTRO_DISTRIBUICAO','VIAGEM','EMISSAO'].includes(c)) return 'IN_TRANSIT'
  return mapStatus(title ?? '')
}

const orders = await prisma.order.findMany({
  where: { carrier: { trackingSystem: 'SAO_MIGUEL' }, status: { in: ['PENDING', 'IN_TRANSIT'] } },
  include: { carrier: true },
  orderBy: { createdAt: 'desc' },
})

console.log(`Total São Miguel para atualizar: ${orders.length}\n`)

let ok = 0, erros = 0, semDados = 0

for (const order of orders) {
  const cnpj = order.senderCnpj?.replace(/\D/g, '') ?? ''
  const nf = String(parseInt(order.nfNumber ?? '0', 10))
  const token = smCreateToken()

  try {
    const res = await fetch(SM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Accept': 'application/json, text/plain, */*',
        'Authorization': `Bearer ${token}`,
        'Origin': 'https://portaldocliente.expressosaomiguel.com.br',
        'Referer': 'https://portaldocliente.expressosaomiguel.com.br/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({ cpfcnpj: cnpj, numberdocument: nf, serie: '', documentType: 'NFE' }),
      signal: AbortSignal.timeout(15000),
    })

    const data = await res.json()

    if (!Array.isArray(data) || data.length === 0) {
      console.log(`${order.orderNumber}: sem dados na API`)
      semDados++
      continue
    }

    const cte = data[0]
    const lastTrack = cte.tracks?.[0]
    const lastEvent = lastTrack?.title ?? null
    const novoStatus = lastEvent ? smMapStatus(lastTrack?.control, lastEvent) : null

    const updates = {
      lastTracking: lastEvent,
      lastTrackingAt: new Date(),
      hasOccurrence: false,
    }

    if (cte.embark) updates.shippedAt = new Date(cte.embark.split('/').reverse().join('-'))
    if (cte.expectedDate) updates.estimatedDelivery = new Date(cte.expectedDate.split('/').reverse().join('-'))

    if (cte.tracks?.length > 0) {
      updates.trackingEvents = cte.tracks.map(t => ({
        date: t.date ? new Date(t.date.split('/').reverse().join('-')).toISOString() : null,
        description: t.title ?? '',
      }))
    }

    if (novoStatus && novoStatus !== order.status) {
      updates.status = novoStatus
      if (novoStatus === 'DELIVERED') updates.deliveredAt = new Date()

      await prisma.order.update({
        where: { id: order.id },
        data: {
          ...updates,
          statusHistory: { create: { status: novoStatus, note: `Sync SM: ${lastEvent}` } },
        },
      })
    } else {
      await prisma.order.update({ where: { id: order.id }, data: updates })
    }

    console.log(`✓ ${order.orderNumber}: "${lastEvent}" → ${novoStatus ?? 'sem mapeamento'} (era ${order.status})`)
    ok++
  } catch (e) {
    console.log(`✗ ${order.orderNumber}: ERRO — ${e.message}`)
    erros++
  }
}

console.log(`\nConcluído: ${ok} atualizados, ${semDados} sem dados, ${erros} erros`)
await prisma.$disconnect()
