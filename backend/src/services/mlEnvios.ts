// Mercado Envios 1 (ME1): o ML exige que o VENDEDOR informe o andamento do envio —
// comunicar "shipped" e "delivered" é obrigatório e a falta é penalizada. Como o ME1 usa
// transportadora própria, quem sabe o que aconteceu é o order-tracker: este serviço leva
// esse estado de volta ao ML automaticamente.
//
// Ligação entre os dois mundos: numeroLoja do pedido no Bling = order (ou pack) id do ML.
//   venda ME1 no ML → numeroLoja no Bling → NF → Order do order-tracker
//
// Sem código de rastreio próprio (a transportadora não fornece um que o ML entenda),
// mandamos o portal do cliente como tracking_url + uma instrução como tracking_number —
// é o mesmo que era feito à mão no painel do ML.
import axios from 'axios'
import { OrderStatus } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { ML_COMPANIES, mlAuth, type MlCompany, type MlAuth } from './mercadolivre'
import { buscarNfsPorNumerosLoja } from '../routes/bling'

const ML_API = 'https://api.mercadolibre.com'
const SERVICE_ID_BRASIL = 11        // service_id de ME1 no MLB (tabela oficial por país)

// CNPJ por empresa — casa o Order certo quando a mesma NF existe nas duas empresas
const COMPANY_CNPJ: Record<MlCompany, string> = {
  avic: '47715256000149',
  agro: '54695386000122',
}

/** O senderCnpj é gravado formatado em uns pedidos e só com dígitos em outros. */
export function cnpjVariantes(company: MlCompany): string[] {
  const d = COMPANY_CNPJ[company]
  const formatado = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  return [d, formatado]
}
const COMPANY_BLING_KEY: Record<MlCompany, string> = { avic: 'avic', agro: 'agrogranja' }

export const PORTAL_URL =
  process.env.ML_ENVIOS_PORTAL_URL?.trim() ||
  'https://order-tracker-production-4189.up.railway.app/portal/'
export const TRACKING_MSG =
  process.env.ML_ENVIOS_TRACKING_MSG?.trim() ||
  'Entre no link e digite seu CPF ou CNPJ para rastrear sua mercadoria'

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type MlEnvioStatus = 'shipped' | 'delivered' | 'not_delivered'

interface ShipmentInfo {
  id: string
  mode: string
  status: string
  substatus: string | null
  dateCreated: Date | null
}

/** Shipment do pedido ML (null quando o pedido não tem envio). */
async function lerShipment(auth: MlAuth, orderId: string): Promise<ShipmentInfo | null> {
  try {
    const { data } = await axios.get(`${ML_API}/orders/${orderId}/shipments`, auth.H)
    if (!data?.id) return null
    const dc = data.date_created ? new Date(data.date_created) : null
    return {
      id: String(data.id),
      mode: String(data.mode ?? ''),
      status: String(data.status ?? ''),
      substatus: data.substatus ?? null,
      dateCreated: dc && !isNaN(dc.getTime()) ? dc : null,
    }
  } catch {
    return null
  }
}

/**
 * Envia a notificação de status ao ML (endpoint V2 — a V1 sai do ar em 31/10/2026).
 * `delivered` e `not_delivered` são FINALIZADORES e IRREVERSÍVEIS no ML.
 */
export async function notificarStatusMl(
  company: MlCompany,
  shipmentId: string,
  status: MlEnvioStatus,
  opts: { date?: Date | null; substatus?: string | null; comment?: string; comTracking?: boolean } = {},
): Promise<void> {
  const auth = await mlAuth(company)
  if (!auth) throw new Error(`Conta ML ${company} não autorizada`)

  const enviar = async (quando: Date) => {
    const body: Record<string, unknown> = {
      payload: {
        service_id: SERVICE_ID_BRASIL,
        date: quando.toISOString(),
        ...(opts.comment ? { comment: opts.comment } : {}),
      },
      status,
      substatus: opts.substatus ?? null,   // JSON null quando não há substatus (exigência da V2)
    }
    // tracking_number e tracking_url andam SEMPRE juntos (ou nenhum dos dois)
    if (opts.comTracking) {
      body.tracking_number = TRACKING_MSG
      body.tracking_url = PORTAL_URL
    }
    await axios.post(`${ML_API}/v2/shipments/${shipmentId}/seller_notifications`, body, auth.H)
  }

  try {
    await enviar(opts.date && !isNaN(opts.date.getTime()) ? opts.date : new Date())
  } catch (err) {
    const resp = axios.isAxiosError(err) ? err.response : undefined
    const code = (resp?.data as { error_code?: string } | undefined)?.error_code
    // data anterior à criação do envio: o ML recusa — repete com a data de agora
    if (code === 'event_date_before_shipment_creation_date') {
      await enviar(new Date())
      return
    }
    const msg = (resp?.data as { message?: string } | undefined)?.message
    throw new Error(msg ? `${code ?? resp?.status}: ${msg}` : (err as Error).message)
  }
}

/**
 * Casa pedidos do order-tracker com vendas ME1 do ML (grava mlOrderId/mlShipmentId).
 * Parte das vendas do ML (poucas em ME1) e desce até a NF pelo Bling.
 */
export async function vincularVendasMe1(dias = 45): Promise<{ vinculados: number; me1: number }> {
  let vinculados = 0
  let me1Total = 0
  const desde = new Date(Date.now() - dias * 86400_000).toISOString()

  // vendas já casadas (ou já finalizadas no ML) não precisam ser consultadas de novo
  const conhecidos = new Set(
    (await prisma.order.findMany({
      where: { mlOrderId: { not: null } },
      select: { mlOrderId: true },
    })).map((o) => o.mlOrderId as string),
  )

  for (const company of ML_COMPANIES) {
    const auth = await mlAuth(company)
    if (!auth) continue

    // 1) vendas recentes da conta
    const orders: { id: string; packId: string | null }[] = []
    for (let offset = 0; offset < 200; offset += 50) {
      try {
        const { data } = await axios.get(`${ML_API}/orders/search`, {
          ...auth.H,
          params: {
            seller: auth.userId,
            'order.date_created.from': desde,
            sort: 'date_desc',
            offset,
            limit: 50,
          },
        })
        const results = data?.results ?? []
        for (const o of results) {
          const id = String(o.id)
          if (conhecidos.has(id)) continue   // já vinculada em um ciclo anterior
          orders.push({ id, packId: o.pack_id ? String(o.pack_id) : null })
        }
        if (results.length < 50) break
      } catch {
        break
      }
      await dorme(300)
    }

    // 2) só as ME1 que ainda não foram finalizadas no ML
    const me1: { orderId: string; packId: string | null; shipment: ShipmentInfo }[] = []
    for (const o of orders) {
      const sh = await lerShipment(auth, o.id)
      if (sh && sh.mode === 'me1' && sh.status !== 'delivered' && sh.status !== 'not_delivered') {
        me1.push({ orderId: o.id, packId: o.packId, shipment: sh })
      }
      await dorme(120)
    }
    me1Total += me1.length
    if (me1.length === 0) continue

    // 3) numeroLoja (order id, ou pack id quando a venda tem pacote) → nº da NF
    const alvos: string[] = []
    for (const m of me1) {
      alvos.push(m.orderId)
      if (m.packId) alvos.push(m.packId)
    }
    const nfPorLoja = await buscarNfsPorNumerosLoja(COMPANY_BLING_KEY[company], alvos, dias + 15)

    // 4) grava o vínculo no pedido correspondente
    for (const m of me1) {
      const nf = nfPorLoja.get(m.orderId) ?? (m.packId ? nfPorLoja.get(m.packId) : undefined)
      if (!nf) continue
      const order = await prisma.order.findFirst({
        where: { nfNumber: nf, senderCnpj: { in: cnpjVariantes(company) } },
        select: { id: true, mlShipmentId: true },
      })
      if (!order) continue
      await prisma.order.update({
        where: { id: order.id },
        data: {
          mlCompany: company,
          mlOrderId: m.orderId,
          mlShipmentId: m.shipment.id,
          mlVinculoTentadoAt: new Date(),
        },
      })
      if (!order.mlShipmentId) vinculados++
    }
  }
  return { vinculados, me1: me1Total }
}

export interface ResultadoEnvio {
  orderNumber: string
  nfNumber: string | null
  mlShipmentId: string
  acao: 'shipped' | 'delivered' | 'shipped+delivered'
  ok: boolean
  erro?: string
}

/**
 * Leva ao ML o estado dos pedidos ME1 já vinculados:
 *  • despachado (IN_TRANSIT com CT-e) → "shipped" + link do portal
 *  • entregue pela transportadora    → "delivered" (finalizador)
 * `dryRun` apenas lista o que seria enviado, sem tocar no ML.
 */
export async function sincronizarEnviosMl(
  opts: { dryRun?: boolean; limite?: number } = {},
): Promise<{ processados: number; resultados: ResultadoEnvio[]; dryRun: boolean }> {
  const dryRun = opts.dryRun ?? false
  const pendentes = await prisma.order.findMany({
    where: {
      mlShipmentId: { not: null },
      mlCompany: { not: null },
      OR: [
        { status: OrderStatus.IN_TRANSIT, mlShippedNotifiedAt: null, lastTracking: { not: null } },
        { status: OrderStatus.DELIVERED, mlDeliveredNotifiedAt: null },
      ],
    },
    select: {
      id: true, orderNumber: true, nfNumber: true, status: true,
      shippedAt: true, deliveredAt: true, lastTracking: true,
      mlCompany: true, mlShipmentId: true, mlShippedNotifiedAt: true,
    },
    orderBy: { shippedAt: 'asc' },
    take: opts.limite ?? 40,
  })

  const resultados: ResultadoEnvio[] = []
  for (const o of pendentes) {
    const company = o.mlCompany as MlCompany
    const precisaShipped = !o.mlShippedNotifiedAt
    const precisaDelivered = o.status === OrderStatus.DELIVERED
    const acao: ResultadoEnvio['acao'] = precisaShipped && precisaDelivered
      ? 'shipped+delivered'
      : precisaDelivered ? 'delivered' : 'shipped'

    if (dryRun) {
      resultados.push({ orderNumber: o.orderNumber, nfNumber: o.nfNumber, mlShipmentId: o.mlShipmentId!, acao, ok: true })
      continue
    }

    try {
      // "A caminho" primeiro: mantém a sequência que o comprador vê no app do ML e é
      // onde entra o link do portal (o comprador rastreia com CPF/CNPJ).
      if (precisaShipped) {
        await notificarStatusMl(company, o.mlShipmentId!, 'shipped', {
          date: o.shippedAt,
          comment: o.lastTracking ?? undefined,
          comTracking: true,
        })
        await prisma.order.update({
          where: { id: o.id },
          data: { mlShippedNotifiedAt: new Date(), mlEnvioErro: null },
        })
        if (precisaDelivered) await dorme(1500)
      }
      if (precisaDelivered) {
        await notificarStatusMl(company, o.mlShipmentId!, 'delivered', {
          date: o.deliveredAt,
          comment: o.lastTracking ?? undefined,
        })
        await prisma.order.update({
          where: { id: o.id },
          data: { mlDeliveredNotifiedAt: new Date(), mlEnvioErro: null },
        })
      }
      resultados.push({ orderNumber: o.orderNumber, nfNumber: o.nfNumber, mlShipmentId: o.mlShipmentId!, acao, ok: true })
      console.log(`[ME1] ${o.orderNumber} → ${acao} (shipment ${o.mlShipmentId})`)
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err)
      await prisma.order.update({ where: { id: o.id }, data: { mlEnvioErro: erro.slice(0, 300) } })
      resultados.push({ orderNumber: o.orderNumber, nfNumber: o.nfNumber, mlShipmentId: o.mlShipmentId!, acao, ok: false, erro })
      console.error(`[ME1] ${o.orderNumber} falhou: ${erro}`)
    }
    await dorme(700)   // respeita o rate limit do ML
  }
  return { processados: resultados.length, resultados, dryRun }
}

/** Ciclo completo usado pelo cron: casa vendas novas e notifica o que estiver pendente. */
export async function cicloEnviosMl(dryRun = false) {
  const vinculo = await vincularVendasMe1()
  const envio = await sincronizarEnviosMl({ dryRun })
  return { ...vinculo, ...envio }
}
