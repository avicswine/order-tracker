/**
 * Rastreio dos envios feitos pela Frenet (J&T, Correios…), que entram na Frenet pela integração com o Bling.
 *
 * Fontes: docs.frenet.com.br (trackorder, getshipmentsasync) e o e-mail de liberação da Frenet (24/11/2026):
 *   - lista de envios: GET https://whitelabel.apifrenet.com.br/v1/shipments (página começa em 0) com os headers
 *     `token` (Token de Cliente da conta) e `x-partner-token` (um só, da integração, vale para as três contas);
 *   - rastreio: POST https://api.frenet.com.br/tracking/trackinginfo só com `token` (o Partner Token ali dá 401).
 * SÓ LEITURA: nada aqui cria, paga ou cancela envio (essas rotas debitam a carteira da Frenet).
 *
 * O elo envio → nota: `orderId` do envio é o número do PEDIDO DE VENDA no Bling (conferido pelo José: AVIC 14246 =
 * venda do Kawan; AGRO 6641/6638…). Do pedido chega-se à NF pelo Bling (pedido → notaFiscal.id → número).
 * O código de rastreio é `volumes[].labelId`; o serviço, `quotation.shippingServiceCode` (J&T Standard = JTE_INT).
 */
import { OrderStatus } from '@prisma/client'
import type { TrackingEvent, TrackingResult } from './tracking'

const URL_ENVIOS = 'https://whitelabel.apifrenet.com.br/v1/shipments'
const URL_RASTREIO = 'https://api.frenet.com.br/tracking/trackinginfo'
const TIMEOUT_MS = 20000
/** envios por página e quantas páginas ler por conta a cada rodada (os mais recentes vêm primeiro) */
const POR_PAGINA = 100
const MAX_PAGINAS = 5

export type EmpresaFrenet = 'AVIC' | 'AGRO' | 'EQUI'
export const EMPRESAS_FRENET: EmpresaFrenet[] = ['AVIC', 'AGRO', 'EQUI']

/** Token de Cliente de cada conta (variáveis FRENET_TOKEN_<EMPRESA> no Railway). Vazio = conta não configurada. */
export function tokenDaConta(empresa: EmpresaFrenet): string {
  return process.env[`FRENET_TOKEN_${empresa}`]?.trim() ?? ''
}
const tokenParceiro = () => process.env.FRENET_PARTNER_TOKEN?.trim() ?? ''

export interface EnvioFrenet {
  shipmentId: string
  /** número do pedido de venda no Bling */
  pedido: string
  codigo: string
  servico: string
  /** página pública de rastreio da Frenet (ex.: https://rastreio.frenet.com.br/JTE/888…) */
  url: string | null
}

/** Envios com código de rastreio (já pagos/postados) das primeiras páginas da conta. */
export async function listarEnviosComCodigo(empresa: EmpresaFrenet): Promise<EnvioFrenet[]> {
  const token = tokenDaConta(empresa)
  if (!token || !tokenParceiro()) return []
  const envios: EnvioFrenet[] = []
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const r = await fetch(`${URL_ENVIOS}?page=${pagina}&per_page=${POR_PAGINA}`, {
      headers: { token, 'x-partner-token': tokenParceiro(), Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // fim da lista: a Frenet responde 404 em vez de uma página vazia (visto na conta da EQUI, 2 envios)
    if (r.status === 404 && pagina > 0) break
    if (!r.ok) throw new Error(`Frenet ${empresa}: lista de envios respondeu HTTP ${r.status}`)
    const d = (await r.json()) as { shipments?: { shipmentId?: number; orderId?: string; trackingUrl?: string; quotation?: { shippingServiceCode?: string }; volumes?: { labelId?: string | null }[] }[] }
    const lista = d.shipments ?? []
    for (const s of lista) {
      const codigo = (s.volumes ?? []).map((v) => v.labelId).find((c): c is string => !!c)
      const servico = s.quotation?.shippingServiceCode
      if (codigo && servico && s.shipmentId && s.orderId) {
        envios.push({ shipmentId: String(s.shipmentId), pedido: String(s.orderId), codigo, servico, url: s.trackingUrl || null })
      }
    }
    if (lista.length < POR_PAGINA) break
  }
  return envios
}

/** EventType da Frenet (docs, webhook de tracking): 3 devolvido e 4 extravio são ocorrência; 9 e 18, entregue */
const TIPOS_ENTREGUE = ['9', '18']
const TIPOS_OCORRENCIA = ['3', '4']
/** 5 = em rota de entrega */
const TIPO_SAIU_PARA_ENTREGA = '5'

/** "2026-11-23 10:14:12" vem no horário de Brasília */
function dataFrenet(s: string | undefined): Date | null {
  if (!s || s.startsWith('0001')) return null
  const d = new Date(`${s.replace(' ', 'T')}-03:00`)
  return isNaN(d.getTime()) ? null : d
}

/** Rastreio de um envio. Status null quando a Frenet ainda não tem evento (envio pago e não postado). */
export async function rastrearFrenet(empresa: EmpresaFrenet, servico: string, codigo: string): Promise<TrackingResult> {
  const token = tokenDaConta(empresa)
  if (!token) return { status: null, lastEvent: `Frenet: conta ${empresa} sem token configurado` }
  const r = await fetch(URL_RASTREIO, {
    method: 'POST',
    headers: { token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ShippingServiceCode: servico, TrackingNumber: codigo }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`Frenet ${empresa}: rastreio respondeu HTTP ${r.status}`)
  const d = (await r.json()) as {
    ErrorMessage?: string
    TrackingEvents?: { EventDateTime?: string; EventDescription?: string; EventType?: string; EventLocation?: string }[]
  }
  if (d.ErrorMessage) return { status: null, lastEvent: `Frenet: ${d.ErrorMessage}` }
  const brutos = (d.TrackingEvents ?? []).filter((e) => e.EventDescription)
  // A transportadora escreve do seu jeito (J&T: "O pacote foi assinado!"), mas o aviso ao cliente reconhece
  // entrega e saída para entrega pelo texto. O tipo do evento da Frenet diz o que é: põe o rótulo na frente.
  const eventos: TrackingEvent[] = brutos.map((e) => {
    const tipo = String(e.EventType ?? '')
    const rotulo = TIPOS_ENTREGUE.includes(tipo) ? 'Entregue: ' : tipo === TIPO_SAIU_PARA_ENTREGA ? 'Saiu para entrega: ' : ''
    return { date: dataFrenet(e.EventDateTime), description: rotulo + e.EventDescription!.trim() }
  })
  if (!eventos.length) return { status: null, lastEvent: null }
  // a Frenet devolve do mais recente para o mais antigo
  const tipos = brutos.map((e) => String(e.EventType ?? ''))
  const entregue = tipos.some((t) => TIPOS_ENTREGUE.includes(t))
  return {
    status: entregue ? OrderStatus.DELIVERED : OrderStatus.IN_TRANSIT,
    lastEvent: eventos[0].description,
    shippedAt: eventos[eventos.length - 1].date,
    hasOccurrence: !entregue && TIPOS_OCORRENCIA.includes(tipos[0]),
    events: eventos,
  }
}
