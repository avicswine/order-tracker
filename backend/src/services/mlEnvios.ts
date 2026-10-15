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
import { consultarNumeroPedidoLoja, buscarNfsPorNumerosLoja } from '../routes/bling'
import { isOutForDeliveryEvent } from './notifier'

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
  /** Prazo que o ML promete ao comprador — base da métrica de atraso do marketplace. */
  promessaEntrega: Date | null
}

function lerPromessa(data: Record<string, unknown>): Date | null {
  const opt = data.shipping_option as { estimated_delivery_time?: { date?: string } } | undefined
  const raw = opt?.estimated_delivery_time?.date
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d
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
      promessaEntrega: lerPromessa(data),
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
    const dc = data.date_created ? new Date(data.date_created) : null
    return {
      id: String(data.id),
      mode: String(data.mode ?? ''),
      status: String(data.status ?? ''),
      substatus: data.substatus ?? null,
      dateCreated: dc && !isNaN(dc.getTime()) ? dc : null,
      promessaEntrega: lerPromessa(data),
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
    // Data anterior à criação do envio: o ML recusa. Repetir com a data de HOJE
    // carimbava um atraso que não existiu (foi o que inflou as vendas do backfill:
    // entrega de 26/08 registrada como 12/09). Usa a criação do envio — a data mais
    // antiga que o ML aceita, logo a mais próxima da realidade.
    if (code === 'event_date_before_shipment_creation_date') {
      const info = await lerShipmentPorId(auth, shipmentId)
      const minima = info?.dateCreated ? new Date(info.dateCreated.getTime() + 60_000) : new Date()
      await enviar(minima)
      return
    }
    const msg = (resp?.data as { message?: string } | undefined)?.message
    throw new Error(msg ? `${code ?? resp?.status}: ${msg}` : (err as Error).message)
  }
}

/** Feedback do VENDEDOR no pedido (vendas "a combinar": `fulfilled` = entrega informada). */
async function feedbackVendedor(auth: MlAuth, orderId: string): Promise<{ fulfilled: boolean } | null> {
  try {
    const { data } = await axios.get(`${ML_API}/orders/${orderId}/feedback`, auth.H)
    if (!data?.sale) return null
    return { fulfilled: data.sale.fulfilled === true }
  } catch {
    return null
  }
}

/**
 * Venda "COMBINAR ENTREGA" (tag no_shipping): não existe shipment, então o ML não aceita
 * seller_notifications. O equivalente ao botão "O comprador já está com ele em mãos" do
 * painel é o feedback do pedido com fulfilled = true (confirmado no pedido 2000018261088844).
 */
export async function marcarEntregaCombinada(company: MlCompany, orderId: string): Promise<void> {
  const auth = await mlAuth(company)
  if (!auth) throw new Error(`Conta ML ${company} não autorizada`)
  const atual = await feedbackVendedor(auth, orderId)
  if (atual?.fulfilled) return   // já informado (pelo painel ou por nós)
  try {
    await axios.post(`${ML_API}/orders/${orderId}/feedback`,
      { fulfilled: true, rating: 'positive' }, auth.H)
  } catch (err) {
    const resp = axios.isAxiosError(err) ? err.response : undefined
    const msg = (resp?.data as { message?: string } | undefined)?.message
    // feedback já existente = entrega já informada; não é erro
    if (resp?.status === 400 && /already|exist/i.test(msg ?? '')) return
    throw new Error(msg ? `${resp?.status}: ${msg}` : (err as Error).message)
  }
}

/**
 * Vínculo pelo lado do ML: lista as vendas recentes, fica só com as ME1 e casa com a NF
 * em LOTE (buscarNfsPorNumerosLoja).
 *
 * É o caminho barato: ~15 chamadas ao Bling para a janela inteira, contra 2 por pedido do
 * caminho antigo — que, com o 429 do Bling, descartava venda ME1 boa como "não é do ML" e
 * deixava o cliente sem ver o despacho.
 */
export async function revisarMe1PeloMl(dias = 20): Promise<{ vinculados: number; me1: number }> {
  let vinculados = 0
  let me1total = 0

  for (const company of ML_COMPANIES) {
    const auth = await mlAuth(company)
    if (!auth) continue

    const from = new Date(Date.now() - dias * 86400_000).toISOString()
    const vendas: { id: string; pack: string | null; ship: string | null }[] = []
    for (let off = 0; off < 500; off += 50) {
      try {
        const { data } = await axios.get(`${ML_API}/orders/search`, {
          ...auth.H,
          params: { seller: auth.userId, sort: 'date_desc', limit: 50, offset: off, 'order.date_created.from': from },
        })
        const rs = (data?.results ?? []) as { id: unknown; pack_id?: unknown; shipping?: { id?: unknown } }[]
        for (const o of rs) {
          vendas.push({
            id: String(o.id),
            pack: o.pack_id ? String(o.pack_id) : null,
            ship: o.shipping?.id ? String(o.shipping.id) : null,
          })
        }
        if (rs.length < 50) break
      } catch { break }
      await dorme(120)
    }
    if (vendas.length === 0) continue

    // já vinculados não precisam de nova consulta de shipment
    const conhecidos = new Set(
      (await prisma.order.findMany({
        where: { mlShipmentId: { in: vendas.map((v) => v.ship).filter(Boolean) as string[] } },
        select: { mlShipmentId: true },
      })).map((o) => o.mlShipmentId!),
    )

    const me1: { ship: string; id: string; pack: string | null; promessa: Date | null }[] = []
    for (const v of vendas) {
      if (!v.ship || conhecidos.has(v.ship)) continue
      try {
        const { data } = await axios.get(`${ML_API}/shipments/${v.ship}`, auth.H)
        if (data?.mode === 'me1') {
          me1.push({ ship: v.ship, id: v.id, pack: v.pack, promessa: lerPromessa(data) })
        }
      } catch { /* envio inacessível — tenta no próximo ciclo */ }
      await dorme(110)
    }
    me1total += me1.length
    if (me1.length === 0) continue

    const alvos: string[] = []
    for (const m of me1) { alvos.push(m.id); if (m.pack) alvos.push(m.pack) }
    const nfPorLoja = await buscarNfsPorNumerosLoja(COMPANY_BLING_KEY[company], alvos, dias + 10)

    for (const m of me1) {
      const nf = nfPorLoja.get(m.id) ?? (m.pack ? nfPorLoja.get(m.pack) : undefined)
      if (!nf) continue   // NF ainda não emitida/importada — próxima rodada pega
      const order = await prisma.order.findFirst({
        where: {
          nfNumber: { in: [nf, String(parseInt(nf, 10)), nf.padStart(6, '0')] },
          senderCnpj: { in: cnpjVariantes(company) },
          mlShipmentId: null,
        },
        select: { id: true, orderNumber: true },
      })
      if (!order) continue
      await prisma.order.update({
        where: { id: order.id },
        data: {
          mlCompany: company, mlOrderId: m.id, mlShipmentId: m.ship,
          mlPromessaEntrega: m.promessa, mlSemEnvio: false,
        },
      })
      vinculados++
      console.log(`[ME1] ${order.orderNumber} vinculado à venda ${m.id} (shipment ${m.ship})`)
    }
  }

  return { vinculados, me1: me1total }
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
      mlSemEnvio: false,
      status: { in: [OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED] },
      OR: [{ mlVinculoTentadoAt: null }, { mlVinculoTentadoAt: { lt: reTentarAntesDe } }],
    },
    select: { id: true, nfNumber: true, senderCnpj: true },
    orderBy: { nfIssuedAt: 'desc' },
    take: 40,   // lote curto: a chamada pelo painel precisa responder antes do timeout
  })

  for (const o of candidatos) {
    const company = ML_COMPANIES.find((c) => cnpjVariantes(c).includes(o.senderCnpj ?? ''))
    if (!company) continue

    const consulta = await consultarNumeroPedidoLoja(COMPANY_BLING_KEY[company], o.nfNumber!)
    // Consulta inconclusiva (429 do Bling, rede): NÃO marca como tentado — senão a venda
    // ficaria 12h fora da fila por um erro passageiro, que foi o que travou o ME1.
    if (!consulta.ok) { await dorme(300); continue }

    await prisma.order.update({ where: { id: o.id }, data: { mlVinculoTentadoAt: new Date() } })

    const pedidoLoja = consulta.numero
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
    if (!shipment) {
      // sem envio no ML = "combinar entrega": a entrega vai pelo feedback do pedido
      await prisma.order.update({
        where: { id: o.id },
        data: { mlCompany: company, mlOrderId: orderIdMl, mlSemEnvio: true },
      })
      vinculados++
      await dorme(200)
      continue
    }
    if (shipment.mode !== 'me1') continue

    me1++
    await prisma.order.update({
      where: { id: o.id },
      data: {
        mlCompany: company, mlOrderId: orderIdMl, mlShipmentId: shipment.id,
        mlPromessaEntrega: shipment.promessaEntrega,
      },
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
  acao: 'shipped' | 'delivered' | 'shipped+delivered' | 'out_for_delivery'
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
      mlCompany: { not: null },
      AND: [
        { OR: [{ mlShipmentId: { not: null } }, { mlSemEnvio: true }] },
        {
          OR: [
            { status: OrderStatus.IN_TRANSIT, mlShippedNotifiedAt: null, lastTracking: { not: null } },
            { status: OrderStatus.DELIVERED, mlDeliveredNotifiedAt: null },
            // em trânsito, já avisado "a caminho", mas ainda sem o "saiu para entrega"
            { status: OrderStatus.IN_TRANSIT, mlOutForDeliveryAt: null, lastTracking: { not: null } },
          ],
        },
      ],
    },
    select: {
      id: true, orderNumber: true, nfNumber: true, status: true,
      shippedAt: true, deliveredAt: true, lastTracking: true, lastTrackingAt: true,
      mlCompany: true, mlShipmentId: true, mlShippedNotifiedAt: true,
      mlOutForDeliveryAt: true, mlPromessaEntrega: true, mlSemEnvio: true, mlOrderId: true,
    },
    orderBy: { shippedAt: 'asc' },
    take: opts.limite ?? 40,
  })

  const resultados: ResultadoEnvio[] = []
  for (const o of pendentes) {
    const company = o.mlCompany as MlCompany

    // "COMBINAR ENTREGA": só existe o aviso de ENTREGUE (não há "a caminho" sem envio)
    if (o.mlSemEnvio) {
      if (o.status !== OrderStatus.DELIVERED) continue
      if (dryRun) {
        resultados.push({ orderNumber: o.orderNumber, nfNumber: o.nfNumber, mlShipmentId: 'a combinar', acao: 'delivered', ok: true })
        continue
      }
      try {
        await marcarEntregaCombinada(company, o.mlOrderId!)
        await prisma.order.update({
          where: { id: o.id },
          data: { mlDeliveredNotifiedAt: new Date(), mlEnvioErro: null },
        })
        resultados.push({ orderNumber: o.orderNumber, nfNumber: o.nfNumber, mlShipmentId: 'a combinar', acao: 'delivered', ok: true })
        console.log(`[ME1] ${o.orderNumber} → entrega informada (combinar entrega, venda ${o.mlOrderId})`)
      } catch (err) {
        const erro = err instanceof Error ? err.message : String(err)
        await prisma.order.update({ where: { id: o.id }, data: { mlEnvioErro: erro.slice(0, 300) } })
        resultados.push({ orderNumber: o.orderNumber, nfNumber: o.nfNumber, mlShipmentId: 'a combinar', acao: 'delivered', ok: false, erro })
        console.error(`[ME1] ${o.orderNumber} (combinar entrega) falhou: ${erro}`)
      }
      await dorme(700)
      continue
    }

    let precisaShipped = !o.mlShippedNotifiedAt
    const precisaDelivered = o.status === OrderStatus.DELIVERED
    // "saiu para entrega": substatus de shipped — o comprador passa a ver "chega hoje".
    // Só vale enquanto não entregou (delivered é finalizador e vem logo atrás).
    let precisaOutForDelivery = !precisaDelivered
      && !o.mlOutForDeliveryAt
      && isOutForDeliveryEvent(o.lastTracking ?? '')

    // estado REAL no ML: evita repetir um aviso que já está lá (o comprador receberia
    // notificação duplicada) e respeita o que foi avisado à mão pelo painel
    if (!dryRun) {
      const auth = await mlAuth(company)
      const atual = auth ? await lerShipmentPorId(auth, o.mlShipmentId!) : null
      if (atual) {
        // mantém a promessa do ML em dia (o prazo pode ser estendido pelo próprio ML)
        if (atual.promessaEntrega && atual.promessaEntrega.getTime() !== o.mlPromessaEntrega?.getTime()) {
          await prisma.order.update({ where: { id: o.id }, data: { mlPromessaEntrega: atual.promessaEntrega } })
        }
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
        // o ML já está com o substatus — não repete (pode ter vindo do painel)
        if (atual.substatus === 'out_for_delivery' && precisaOutForDelivery) {
          precisaOutForDelivery = false
          await prisma.order.update({ where: { id: o.id }, data: { mlOutForDeliveryAt: new Date() } })
        }
      }
      if (!precisaShipped && !precisaDelivered && !precisaOutForDelivery) continue
    }

    const acao: ResultadoEnvio['acao'] = precisaShipped && precisaDelivered
      ? 'shipped+delivered'
      : precisaDelivered ? 'delivered'
      : precisaShipped ? 'shipped'
      : 'out_for_delivery'

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
        if (precisaDelivered || precisaOutForDelivery) await dorme(1500)
      }
      // "saiu para entrega" só depois do "a caminho" — a doc exige a transição inicial
      // registrada, senão o ML descarta o substatus.
      if (precisaOutForDelivery) {
        await notificarStatusMl(company, o.mlShipmentId!, 'shipped', {
          date: o.lastTrackingAt,
          substatus: 'out_for_delivery',
          comment: o.lastTracking ?? undefined,
        })
        await prisma.order.update({
          where: { id: o.id },
          data: { mlOutForDeliveryAt: new Date(), mlEnvioErro: null },
        })
        console.log(`[ME1] ${o.orderNumber} → saiu para entrega informado ao ML`)
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
  // 1) caminho barato (lado do ML) — pega o que chegou desde a última rodada
  const pelaApi = await revisarMe1PeloMl()
  // 2) rede de segurança pelo lado dos pedidos: cobre venda mais antiga que a janela
  //    do passo 1 e NF que só ganhou o pedido de loja depois
  const porPedido = await vincularVendasMe1()
  const envio = await sincronizarEnviosMl({ dryRun })
  return {
    vinculados: pelaApi.vinculados + porPedido.vinculados,
    me1: pelaApi.me1 + porPedido.me1,
    ...envio,
  }
}
