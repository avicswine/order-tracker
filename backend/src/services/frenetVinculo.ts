/**
 * Liga os envios da Frenet às notas do Order Tracker e guarda o código de rastreio no pedido.
 *
 * O `orderId` do envio na Frenet é o número do PEDIDO DE VENDA no Bling (envios criados pela integração nativa).
 * Do pedido chega-se à NF: pedido → notaFiscal.id → número da NF → pedido do Order Tracker `EMPRESA-NF-<número>`.
 * Envio criado à mão no painel da Frenet (garantia, bonificação, conserto) vem com um identificador interno (UUID)
 * e sem pedido: fica para a ligação manual (outra etapa).
 *
 * Economia de chamadas: cada envio é ligado uma vez só (`frenetShipmentId` no pedido); o Bling é consultado só
 * para os envios ainda não ligados, e a lista de pedidos de venda é lida uma vez por empresa e rodada.
 */
import { prisma } from '../lib/prisma'
import { blingGet } from '../routes/bling'
import { EMPRESAS_FRENET, listarEnviosComCodigo, tokenDaConta, type EmpresaFrenet } from './frenet'

/** empresa → chave da conta no Bling (COMPANIES em routes/bling.ts) */
const CHAVE_BLING: Record<EmpresaFrenet, string> = { AVIC: 'avic', AGRO: 'agrogranja', EQUI: 'equipage' }
/** pedidos de venda dos últimos dias que valem a busca (os envios lidos são os mais recentes) */
const DIAS_PEDIDOS = 45
const MAX_PAGINAS_PEDIDOS = 15
/** nota emitida há mais que isso ao ganhar o código: o primeiro rastreio não avisa o cliente (seria aviso atrasado) */
const DIAS_SEM_AVISO_RETROATIVO = 3

type PedidoLista = { id?: number; numero?: number | string }

async function idsDosPedidos(chaveBling: string, procurados: Set<string>): Promise<Map<string, number>> {
  const ids = new Map<string, number>()
  const inicio = new Date(Date.now() - DIAS_PEDIDOS * 86400000).toISOString().slice(0, 10)
  let semNumero = 0
  for (let pagina = 1; pagina <= MAX_PAGINAS_PEDIDOS && ids.size < procurados.size; pagina++) {
    const r = (await blingGet(chaveBling, `/pedidos/vendas?pagina=${pagina}&limite=100&dataInicial=${inicio}`)) as { data?: PedidoLista[] }
    const lista = r?.data ?? []
    for (const p of lista) {
      if (p.numero == null) { semNumero++; continue }
      const numero = String(p.numero)
      if (procurados.has(numero) && p.id) ids.set(numero, p.id)
    }
    if (lista.length < 100) break
  }
  if (semNumero) console.warn(`[Frenet] Bling (${chaveBling}): ${semNumero} pedido(s) da lista sem o campo "numero" — a ligação depende dele`)
  return ids
}

/** Número da NF do pedido de venda (null se o pedido ainda não tem nota ou não é o pedido procurado). */
async function nfDoPedido(chaveBling: string, idPedido: number, numeroEsperado: string): Promise<string | null> {
  const det = (await blingGet(chaveBling, `/pedidos/vendas/${idPedido}`)) as { data?: { numero?: number | string; notaFiscal?: { id?: number } } }
  // confere que é mesmo o pedido do envio antes de ligar (protege contra pedido trocado)
  if (String(det?.data?.numero ?? '') !== numeroEsperado) return null
  const idNf = det?.data?.notaFiscal?.id
  if (!idNf) return null
  const nfe = (await blingGet(chaveBling, `/nfe/${idNf}`)) as { data?: { numero?: number | string } }
  return nfe?.data?.numero != null ? String(nfe.data.numero) : null
}

export async function vincularEnviosFrenet(): Promise<void> {
  for (const empresa of EMPRESAS_FRENET) {
    if (!tokenDaConta(empresa)) continue
    try {
      const envios = await listarEnviosComCodigo(empresa)
      if (!envios.length) continue
      const ligados = new Set((await prisma.order.findMany({
        where: { frenetShipmentId: { in: envios.map((e) => e.shipmentId) } }, select: { frenetShipmentId: true },
      })).map((o) => o.frenetShipmentId))
      // só os de pedido do Bling (número); os criados à mão (UUID) ficam para a ligação manual
      const pendentes = envios.filter((e) => !ligados.has(e.shipmentId) && /^\d+$/.test(e.pedido))
      if (!pendentes.length) continue

      const chave = CHAVE_BLING[empresa]
      const idPorNumero = await idsDosPedidos(chave, new Set(pendentes.map((e) => e.pedido)))
      let ligadosAgora = 0
      for (const e of pendentes) {
        const idPedido = idPorNumero.get(e.pedido)
        if (!idPedido) continue
        const nf = await nfDoPedido(chave, idPedido, e.pedido)
        if (!nf) continue
        const pedido = await prisma.order.findUnique({ where: { orderNumber: `${empresa}-NF-${nf}` }, select: { id: true, nfIssuedAt: true, trackingCode: true } })
        if (!pedido) continue // NF fora do Order Tracker (transportador sem rastreio, ou ainda não importada)
        const antiga = !!pedido.nfIssuedAt && Date.now() - pedido.nfIssuedAt.getTime() > DIAS_SEM_AVISO_RETROATIVO * 86400000
        await prisma.order.update({
          where: { id: pedido.id },
          data: {
            trackingCode: e.codigo, trackingUrl: e.url, frenetShipmentId: e.shipmentId, frenetServico: e.servico,
            ...(antiga && !pedido.trackingCode && { silenciarProximoAviso: true }),
          },
        })
        ligadosAgora++
        console.log(`[Frenet] ${empresa}-NF-${nf}: envio ${e.shipmentId} ligado (código ${e.codigo}, ${e.servico})${antiga ? ' — sem aviso retroativo' : ''}`)
      }
      console.log(`[Frenet] ${empresa}: ${ligadosAgora} envio(s) ligado(s) agora · ${pendentes.length - ligadosAgora} sem nota encontrada no Order Tracker`)
    } catch (err) {
      console.error(`[Frenet] ${empresa}: erro ao ligar envios:`, err instanceof Error ? err.message : err)
    }
  }
}
