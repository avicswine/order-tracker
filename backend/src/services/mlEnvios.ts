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
import { numeroPedidoLojaDaNf } from '../routes/bling'

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
// O campo tracking_number do ML aceita SÓ letras e números (testado 12/09/2026): espaço é
// removido e separadores — hífen, ponto, underscore — fazem o ML descartar o valor inteiro.
// Daí o CamelCase, que fica legível sem separador. A frase completa vai no comentário, que
// preserva espaços. Observado também: o ML só registra o código na TRANSIÇÃO de status,
// então quem já está "shipped" não recebe mais o link (vale para os despachos novos).
export const TRACKING_MSG =
  process.env.ML_ENVIOS_TRACKING_MSG?.trim() ||
  'EntreNoLinkEDigiteSeuCPFOuCNPJParaRastrearSuaMercadoria'
export const TRACKING_COMENTARIO =
  process.env.ML_ENVIOS_TRACKING_COMENTARIO?.trim() ||
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

/** Estado atual do envio pelo shipment_id (para não repetir aviso que o ML já tem). */
async function lerShipmentPorId(auth: MlAuth, shipmentId: string): Promise<ShipmentInfo | null> {
  try {
    const { data } = await axios.get(`${ML_API}/shipments/${shipmentId}`, auth.H)
    if (!data?.id) return null
    return {
      id: String(data.id),
      mode: String(data.mode ?? ''),
      status: String(data.status ?? ''),
      substatus: data.substatus ?? null,
      dateCreated: null,
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
 * Casa os pedidos do order-tracker com as vendas ME1 do ML (grava mlCompany/mlOrderId/
 * mlShipmentId). Parte dos PEDIDOS que precisam de aviso — não das vendas do ML: varrer
 * o histórico do ML tinha teto de páginas e deixava venda antiga de fora (era o caso da
 * NF 011978, parada com 17 dias de atraso).
 *
 * Caminho por pedido (2 GETs no Bling + 1 no ML):
 *   NF → numeroPedidoLoja (detalhe da NF-e) → /orders/{id}/shipments → é ME1?
 */
export async function vincularVendasMe1(dias = 60): Promise<{ vinculados: number; me1: number }> {
  let vinculados = 0
  let me1 = 0
  const desde = new Date(Date.now() - dias * 86400_000)
  // re-tenta um pedido sem vínculo só depois de 12h (NF pode demorar a ter o pedido)
  const reTentarAntesDe = new Date(Date.now() - 12 * 3600_000)

  const candidatos = await prisma.order.findMany({
    where: {
      nfNumber: { not: null },
      nfIssuedAt: { gte: desde },
      mlShipmentId: null,
      status: { in: [OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED] },
      OR: [{ mlVinculoTentadoAt: null }, { mlVinculoTentadoAt: { lt: reTentarAntesDe } }],
    },
    select: { id: true, nfNumber: true, senderCnpj: true },
    orderBy: { nfIssuedAt: 'desc' },
    take: 120,
  })

  for (const o of candidatos) {
    const company = ML_COMPANIES.find((c) => cnpjVariantes(c).includes(o.senderCnpj ?? ''))
    if (!company) continue
    await prisma.order.update({ where: { id: o.id }, data: { mlVinculoTentadoAt: new Date() } })

    const pedidoLoja = await numeroPedidoLojaDaNf(COMPANY_BLING_KEY[company], o.nfNumber!)
    // vendas do ML têm id numérico longo; pedido de balcão/site não casa e é ignorado
    if (!pedidoLoja || !/^\d{10,}$/.test(pedidoLoja)) continue

    const auth = await mlAuth(company)
    if (!auth) continue
    let shipment = await lerShipment(auth, pedidoLoja)
    let orderIdMl = pedidoLoja
    if (!shipment) {
      // numeroPedidoLoja pode ser o pack (carrinho): pega a 1ª order do pacote
      try {
        const { data: pack } = await axios.get(`${ML_API}/packs/${pedidoLoja}`, auth.H)
        const primeira = pack?.orders?.[0]?.id
        if (primeira) {
          orderIdMl = String(primeira)
          shipment = await lerShipment(auth, orderIdMl)
        }
      } catch { /* não é pacote */ }
    }
    if (!shipment || shipment.mode !== 'me1') continue

    me1++
    await prisma.order.update({
      where: { id: o.id },
      data: { mlCompany: company, mlOrderId: orderIdMl, mlShipmentId: shipment.id },
    })
    vinculados++
    await dorme(200)
  }
  return { vinculados, me1 }
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
    let precisaShipped = !o.mlShippedNotifiedAt
    let precisaDelivered = o.status === OrderStatus.DELIVERED

    // estado REAL no ML: evita repetir um aviso que já está lá (o comprador receberia
    // notificação duplicada) e respeita o que foi avisado à mão pelo painel
    if (!dryRun) {
      const auth = await mlAuth(company)
      const atual = auth ? await lerShipmentPorId(auth, o.mlShipmentId!) : null
      if (atual) {
        if (atual.status === 'delivered' || atual.status === 'not_delivered') {
          await prisma.order.update({
            where: { id: o.id },
            data: { mlShippedNotifiedAt: o.mlShippedNotifiedAt ?? new Date(), mlDeliveredNotifiedAt: new Date() },
          })
          continue   // ML já está finalizado — nada a fazer
        }
        if (atual.status === 'shipped' && precisaShipped) {
          precisaShipped = false   // já consta "a caminho" no ML
          await prisma.order.update({ where: { id: o.id }, data: { mlShippedNotifiedAt: new Date() } })
        }
      }
      if (!precisaShipped && !precisaDelivered) continue
    }

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
          comment: TRACKING_COMENTARIO,   // instrução ao comprador (aceita espaços)
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
