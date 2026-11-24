/**
 * Tipo de envio e rastreio do Mercado Livre das vendas da lista de guias do DIFAL (pedidos do José em 20/11/2026).
 * Só leitura no ML e só nas vendas que aparecem na lista (DIFAL > 0, nota de até 30 dias): a conta do ML já foi
 * bloqueada, então as chamadas são poucas, com pausa, no máximo LIMITE_POR_RODADA por vez, e param no primeiro 429.
 *   1) venda sem tipo de envio: lê a venda e o envio uma vez (tipo + status do envio)
 *   2) venda do Mercado Envios ainda não entregue: relê só o envio (status atual); entregue não é lida de novo
 *
 * Valores do ML como o projeto já usa (cmvsync/ml_client.py:438 e :1450; services/mlEnvios.ts:67, :83 e :247):
 *   logistic_type: fulfillment (Full), cross_docking (Coleta), drop_off/xd_drop_off/places (agência), self_service (Flex)
 *   mode: me1 (logística própria ME1), custom/not_specified (a combinar)
 *   status do envio: ready_to_ship, shipped (substatus out_for_delivery), delivered, not_delivered, cancelled
 *   previsão: shipping_option.estimated_delivery_time.date
 */
import axios from 'axios'
import type { PrismaClient } from '@prisma/client'
import { mlAuth, type MlCompany } from '../mercadolivre'
import { dataBR, somarDias } from '../separacao/datas'
import { JANELA_ML_DIAS, LOGISTICAS_ML_RECOLHE, filtroVendasMl } from './guias'

const ML_API = 'https://api.mercadolibre.com'
/** pausa entre chamadas, para não pressionar o limite do ML */
const PAUSA_MS = 150
/** no máximo por rodada (tipo de envio + rastreio juntos), em VENDAS: o resto fica para a próxima atualização */
const LIMITE_POR_RODADA = 100
/** e no máximo estas CHAMADAS ao ML por rodada (venda de carrinho pode gastar até 4 na primeira leitura) */
const LIMITE_CHAMADAS = 150
/** envio em andamento só é relido depois deste intervalo (vários cliques seguidos não gastam chamadas) */
const RELER_APOS_HORAS = 6
/** envios do ML (a mercadoria vai pela logística do ML): só neles o rastreio vem do ML — a mesma lista de quem recolhe o DIFAL */
const LOGISTICAS_MERCADO_ENVIOS = LOGISTICAS_ML_RECOLHE
/** status em que o envio não muda mais: não se consulta de novo */
const STATUS_FINAIS = ['delivered', 'not_delivered', 'cancelled']

type Auth = { headers: Record<string, string>; timeout: number }
const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** rótulo para a tela a partir do envio do ML */
export function rotuloLogistica(logisticType: string | null | undefined, mode: string | null | undefined): string {
  if (logisticType === 'fulfillment') return 'FULL'
  if (logisticType === 'cross_docking') return 'Coleta'
  if (logisticType === 'self_service') return 'Flex'
  if (logisticType === 'drop_off' || logisticType === 'xd_drop_off' || logisticType === 'places') return 'Agência'
  if (mode === 'me1') return 'ME1'
  if (mode === 'custom' || mode === 'not_specified') return 'A combinar'
  return `outro (${logisticType ?? '?'}/${mode ?? '?'})`
}

class LimiteMl extends Error {}

/** chamadas ao ML feitas nesta rodada (zerado no começo de preencherLogisticaMl) */
let chamadas = 0

async function lerJson(url: string, auth: Auth): Promise<Record<string, unknown> | null> {
  if (chamadas >= LIMITE_CHAMADAS) throw new LimiteMl(`limite de ${LIMITE_CHAMADAS} chamadas por atualização`)
  chamadas++
  try {
    const { data } = await axios.get(url, auth)
    return data as Record<string, unknown>
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status
    if (status === 429) throw new LimiteMl('o ML pediu para esperar (429)')
    if (status === 404) return null
    throw e
  }
}

/** campos do envio que a tela mostra */
function rastreioDoEnvio(envioId: string, envio: Record<string, unknown>) {
  const opcao = envio.shipping_option as { estimated_delivery_time?: { date?: string } } | undefined
  const previsao = opcao?.estimated_delivery_time?.date
  return {
    mlEnvioId: envioId,
    mlEnvioStatus: envio.status ? String(envio.status) : null,
    mlEnvioSubstatus: envio.substatus ? String(envio.substatus) : null,
    mlPrevisao: previsao ? new Date(previsao) : null,
    mlEnvioLidoEm: new Date(),
  }
}

/** tipo de envio de uma venda (o número pode ser de venda ou de carrinho) e, havendo envio do ML, o rastreio */
async function lerVenda(id: string, auth: Auth): Promise<{ mlLogistica: string } & Partial<ReturnType<typeof rastreioDoEnvio>>> {
  let venda = await lerJson(`${ML_API}/orders/${id}`, auth)
  if (!venda) {
    // número de carrinho: pega a primeira venda do pack
    const pack = await lerJson(`${ML_API}/packs/${id}`, auth)
    const primeira = (pack?.orders as { id?: unknown }[] | undefined)?.[0]?.id
    if (!primeira) return { mlLogistica: 'não identificado' }
    await dorme(PAUSA_MS)
    venda = await lerJson(`${ML_API}/orders/${String(primeira)}`, auth)
    if (!venda) return { mlLogistica: 'não identificado' }
  }
  const envioId = (venda.shipping as { id?: unknown } | undefined)?.id
  if (!envioId) return { mlLogistica: 'A combinar' } // venda sem envio do ML: entrega combinada com o comprador
  await dorme(PAUSA_MS)
  const envio = await lerJson(`${ML_API}/shipments/${String(envioId)}`, auth)
  if (!envio) return { mlLogistica: 'não identificado' }
  return { mlLogistica: rotuloLogistica(envio.logistic_type as string | undefined, envio.mode as string | undefined), ...rastreioDoEnvio(String(envioId), envio) }
}

/**
 * Preenche o tipo de envio das vendas do ML da lista que ainda não têm e atualiza o rastreio das vendas do
 * Mercado Envios ainda não entregues. Para no primeiro 429.
 */
export async function preencherLogisticaMl(prisma: PrismaClient): Promise<{ lidas: number; erros: string[] }> {
  chamadas = 0
  const limite = new Date(`${somarDias(dataBR(), -JANELA_ML_DIAS)}T00:00:00Z`) // emitidaEm guarda Brasília como UTC
  // só as vendas que aparecem na lista de guias (mesmo filtro da tela): comprovante enviado, nota cancelada ou
  // divergente saem da lista e não gastam chamada
  const daLista = { AND: [filtroVendasMl(), { emitidaEm: { gte: limite }, difalCalculado: { gt: 0 }, mlOrderId: { not: null } }] }
  const semTipo = await prisma.difalNota.findMany({
    // sem tipo de envio, ou do Mercado Envios lida antes de o rastreio existir (sem o número do envio, tentada uma vez)
    where: {
      ...daLista,
      OR: [
        // sem tipo: tenta de novo só depois do intervalo, se a última tentativa deu erro
        { mlLogistica: null, OR: [{ mlEnvioLidoEm: null }, { mlEnvioLidoEm: { lt: new Date(Date.now() - RELER_APOS_HORAS * 3600_000) } }] },
        { mlLogistica: { in: LOGISTICAS_MERCADO_ENVIOS }, mlEnvioId: null, mlEnvioLidoEm: null },
      ],
    },
    select: { id: true, empresa: true, nfNumero: true, mlOrderId: true, mlEnvioId: true, mlLogistica: true },
    orderBy: { emitidaEm: 'desc' },
    take: LIMITE_POR_RODADA,
  })
  // rastreio: Mercado Envios, já com o envio conhecido e ainda não entregue; o que foi lido há mais tempo primeiro
  const emAndamento = await prisma.difalNota.findMany({
    where: {
      mlLogistica: { in: LOGISTICAS_MERCADO_ENVIOS }, mlEnvioId: { not: null },
      AND: [
        ...daLista.AND, // filtro da lista + as condições abaixo (um AND só: dois AND, um apagaria o outro)
        { OR: [{ mlEnvioStatus: null }, { mlEnvioStatus: { notIn: STATUS_FINAIS } }] },
        { OR: [{ mlEnvioLidoEm: null }, { mlEnvioLidoEm: { lt: new Date(Date.now() - RELER_APOS_HORAS * 3600_000) } }] },
      ],
    },
    select: { id: true, empresa: true, nfNumero: true, mlOrderId: true, mlEnvioId: true, mlLogistica: true },
    orderBy: { mlEnvioLidoEm: { sort: 'asc', nulls: 'first' } },
    take: Math.max(0, LIMITE_POR_RODADA - semTipo.length),
  })

  const res = { lidas: 0, erros: [] as string[] }
  const acessos = new Map<string, Auth | null>()
  for (const [n, soRastreio] of [...semTipo.map((n) => [n, false] as const), ...emAndamento.map((n) => [n, true] as const)]) {
    const conta = n.empresa.toLowerCase() as MlCompany
    if (!acessos.has(conta)) {
      try {
        const a = await mlAuth(conta)
        acessos.set(conta, a ? (a.H as Auth) : null)
      } catch (e) {
        // sem acesso ao ML desta conta (ex.: renovação do token falhou): segue sem, sem derrubar a importação
        res.erros.push(`envio ML (${conta}): ${String((e as Error).message).split('\n')[0]}`)
        acessos.set(conta, null)
      }
    }
    const acesso = acessos.get(conta)
    if (!acesso) continue // conta do ML sem token (ex.: no PC): fica para quando houver
    try {
      if (soRastreio) {
        const envio = await lerJson(`${ML_API}/shipments/${n.mlEnvioId}`, acesso)
        // envio sumido (404): só marca a leitura, para não voltar à frente da fila a cada rodada
        await prisma.difalNota.update({ where: { id: n.id }, data: envio ? rastreioDoEnvio(n.mlEnvioId!, envio) : { mlEnvioLidoEm: new Date() } })
      } else {
        const lido = await lerVenda(n.mlOrderId!, acesso)
        // venda já rotulada (ex.: 'Coleta') que não devolveu envio: mantém o rótulo bom e não tenta de novo
        const dados = n.mlLogistica && !lido.mlEnvioId ? { mlEnvioLidoEm: new Date() } : lido
        await prisma.difalNota.update({ where: { id: n.id }, data: dados })
      }
      res.lidas++
    } catch (e) {
      if (e instanceof LimiteMl) {
        res.erros.push(`envio ML: ${e.message}; o resto fica para a próxima atualização`)
        break
      }
      res.erros.push(`envio ML da NF ${n.nfNumero}: ${String((e as Error).message).split('\n')[0]}`)
      // erro dessa venda (403, 500...): marca a leitura, para ela não ser tentada de novo a cada rodada
      await prisma.difalNota.update({ where: { id: n.id }, data: { mlEnvioLidoEm: new Date() } })
    }
    await dorme(PAUSA_MS)
  }
  return res
}
