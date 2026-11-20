/**
 * Tipo de envio das vendas do Mercado Livre na lista de guias do DIFAL (FULL, Coleta, A combinar, ME1...).
 * Pedido do José em 20/11/2026. Só leitura no ML, uma vez por venda e só nas vendas que aparecem na lista
 * (DIFAL > 0, nota de até 7 dias): a conta do ML já foi bloqueada, então chamadas são poucas e param no 429.
 *
 * Valores do ML como o projeto já usa (cmvsync/ml_client.py:438 e :1450; services/mlEnvios.ts:247):
 *   logistic_type: fulfillment (Full), cross_docking (Coleta), drop_off/xd_drop_off/places (agência), self_service (Flex)
 *   mode: me1 (logística própria ME1), custom/not_specified (a combinar)
 */
import axios from 'axios'
import type { PrismaClient } from '@prisma/client'
import { mlAuth, type MlCompany } from '../mercadolivre'
import { dataBR, somarDias } from '../separacao/datas'
import { JANELA_ML_DIAS } from './guias'

const ML_API = 'https://api.mercadolibre.com'
/** pausa entre chamadas, para não pressionar o limite do ML */
const PAUSA_MS = 150
/** no máximo por rodada: o resto fica para a próxima atualização */
const LIMITE_POR_RODADA = 100

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

async function lerJson(url: string, auth: { headers: Record<string, string>; timeout: number }): Promise<Record<string, unknown> | null> {
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

/** tipo de envio de uma venda; o número pode ser de venda ou de carrinho (pack) */
async function logisticaDaVenda(id: string, auth: { headers: Record<string, string>; timeout: number }): Promise<string> {
  let venda = await lerJson(`${ML_API}/orders/${id}`, auth)
  if (!venda) {
    // número de carrinho: pega a primeira venda do pack
    const pack = await lerJson(`${ML_API}/packs/${id}`, auth)
    const primeira = (pack?.orders as { id?: unknown }[] | undefined)?.[0]?.id
    if (!primeira) return 'não identificado'
    await dorme(PAUSA_MS)
    venda = await lerJson(`${ML_API}/orders/${String(primeira)}`, auth)
    if (!venda) return 'não identificado'
  }
  const envioId = (venda.shipping as { id?: unknown } | undefined)?.id
  if (!envioId) return 'A combinar' // venda sem envio do ML: entrega combinada com o comprador
  await dorme(PAUSA_MS)
  const envio = await lerJson(`${ML_API}/shipments/${String(envioId)}`, auth)
  if (!envio) return 'não identificado'
  return rotuloLogistica(envio.logistic_type as string | undefined, envio.mode as string | undefined)
}

/** Preenche o tipo de envio das vendas do ML da lista que ainda não têm. Para no primeiro 429. */
export async function preencherLogisticaMl(prisma: PrismaClient): Promise<{ lidas: number; erros: string[] }> {
  const limite = new Date(`${somarDias(dataBR(), -JANELA_ML_DIAS)}T00:00:00Z`) // emitidaEm guarda Brasília como UTC
  const notas = await prisma.difalNota.findMany({
    where: { responsavel: 'ML_PAGA', difalCalculado: { gt: 0 }, emitidaEm: { gte: limite }, mlLogistica: null, mlOrderId: { not: null } },
    select: { id: true, empresa: true, nfNumero: true, mlOrderId: true },
    orderBy: { emitidaEm: 'desc' },
    take: LIMITE_POR_RODADA,
  })
  const res = { lidas: 0, erros: [] as string[] }
  const acessos = new Map<string, Awaited<ReturnType<typeof mlAuth>>>()
  for (const n of notas) {
    const conta = n.empresa.toLowerCase() as MlCompany
    if (!acessos.has(conta)) acessos.set(conta, await mlAuth(conta))
    const acesso = acessos.get(conta)
    if (!acesso) continue // conta do ML sem token (ex.: no PC): fica para quando houver
    try {
      const rotulo = await logisticaDaVenda(n.mlOrderId!, acesso.H as { headers: Record<string, string>; timeout: number })
      await prisma.difalNota.update({ where: { id: n.id }, data: { mlLogistica: rotulo } })
      res.lidas++
    } catch (e) {
      if (e instanceof LimiteMl) {
        res.erros.push(`tipo de envio ML: ${e.message}; o resto fica para a próxima atualização`)
        break
      }
      res.erros.push(`tipo de envio ML da NF ${n.nfNumero}: ${String((e as Error).message).split('\n')[0]}`)
    }
    await dorme(PAUSA_MS)
  }
  return res
}
