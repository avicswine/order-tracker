/**
 * Busca na fatura do Mercado Livre os lançamentos CDIFAL (o DIFAL que ele recolheu e
 * cobra de nós) e grava em difal_cobrancas_ml.
 *
 * Fonte: API de faturamento do ML, a mesma usada pelo cmvsync (ml_cobrancas.py):
 *   GET /billing/integration/monthly/periods?group=ML&document_type=BILL   (x-version: 2)
 *   GET /billing/integration/periods/key/{chave}/group/ML/details           (x-version: 2)
 * A paginação é por `from_id` (o `offset` tem teto de 10.000 e perde registros).
 * O detalhe traz TODAS as tarifas do período; guardamos só as de sub_type CDIFAL.
 *
 * Só leitura no ML. Poucas chamadas: 1 de períodos + as páginas de detalhe (1.000 por
 * página) de cada mês pedido — por isso o padrão é só 2 meses (atual e anterior).
 */
import axios, { AxiosError } from 'axios'
import type { PrismaClient } from '@prisma/client'
import { mlAuth, type MlCompany } from '../mercadolivre'

const ML_API = 'https://api.mercadolibre.com'
const PAGINA = 1000
const SUB_TIPO_DIFAL = 'CDIFAL'
const ESPERAS_429_MS = [5000, 15000, 40000]

/** empresa do monitor → conta do ML no order-tracker */
const CONTA_ML: Record<string, MlCompany> = { AVIC: 'avic', AGRO: 'agro' }

type Cabecalhos = { headers: Record<string, string> }

interface DetalheMl {
  charge_info?: {
    detail_id?: number | string
    detail_sub_type?: string
    detail_type?: string
    detail_amount?: number | string
    creation_date_time?: string
  }
  sales_info?: { sale_date_time?: string }[]
}

export interface ResultadoCobrancas {
  empresa: string
  periodos: string[]
  lidos: number
  cdifal: number
  erro?: string
}

async function getComEspera<T>(url: string, params: Record<string, unknown>, H: Cabecalhos): Promise<T> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      const { data } = await axios.get<T>(url, {
        params,
        headers: { ...H.headers, 'x-version': '2' },
        timeout: 30000,
      })
      return data
    } catch (e) {
      const status = (e as AxiosError).response?.status
      if (status !== 429 || tentativa >= ESPERAS_429_MS.length) throw e
      await new Promise((r) => setTimeout(r, ESPERAS_429_MS[tentativa]))
    }
  }
}

async function periodos(H: Cabecalhos, meses: number): Promise<string[]> {
  const d = await getComEspera<{ results?: { key?: string }[] }>(
    `${ML_API}/billing/integration/monthly/periods`,
    { group: 'ML', document_type: 'BILL', limit: Math.min(meses, 12), offset: 0 },
    H
  )
  return (d.results ?? []).map((p) => p.key).filter((k): k is string => !!k)
}

async function* detalhes(H: Cabecalhos, chave: string): AsyncGenerator<DetalheMl[]> {
  let fromId: string | number = 0
  while (true) {
    const d: { results?: DetalheMl[]; last_id?: string | number } = await getComEspera(
      `${ML_API}/billing/integration/periods/key/${chave}/group/ML/details`,
      { document_type: 'BILL', limit: PAGINA, from_id: fromId, sort_by: 'ID', order_by: 'ASC' },
      H
    )
    const res = d.results ?? []
    if (!res.length) return
    yield res
    // para só quando a página vem vazia ou o id não avança (regra da doc do ML;
    // página curta NÃO significa fim)
    const ultimo: string | number | undefined = d.last_id ?? res[res.length - 1]?.charge_info?.detail_id
    if (!ultimo || String(ultimo) === String(fromId)) return
    fromId = ultimo
  }
}

export async function sincronizarCobrancasMl(prisma: PrismaClient, meses = 2): Promise<ResultadoCobrancas[]> {
  const saida: ResultadoCobrancas[] = []
  for (const [empresa, conta] of Object.entries(CONTA_ML)) {
    const r: ResultadoCobrancas = { empresa, periodos: [], lidos: 0, cdifal: 0 }
    saida.push(r)
    try {
      const auth = await mlAuth(conta)
      if (!auth) {
        r.erro = `conta do Mercado Livre da ${empresa} não autorizada no order-tracker`
        continue
      }
      r.periodos = await periodos(auth.H, meses)
      for (const chave of r.periodos) {
        for await (const pagina of detalhes(auth.H, chave)) {
          r.lidos += pagina.length
          for (const x of pagina) {
            const ci = x.charge_info ?? {}
            if (ci.detail_sub_type !== SUB_TIPO_DIFAL || !ci.detail_id) continue
            const quando = x.sales_info?.[0]?.sale_date_time ?? ci.creation_date_time
            await prisma.difalCobrancaMl.upsert({
              where: { id: `${empresa}:${ci.detail_id}` },
              update: { valor: Number(ci.detail_amount ?? 0), natureza: ci.detail_type ?? '' },
              create: {
                id: `${empresa}:${ci.detail_id}`,
                empresa,
                periodo: chave,
                data: quando ? new Date(quando) : new Date(),
                natureza: ci.detail_type ?? '',
                valor: Number(ci.detail_amount ?? 0),
              },
            })
            r.cdifal++
          }
        }
      }
    } catch (e) {
      // erro de API nunca passa em silêncio; sem token na mensagem
      const status = (e as AxiosError).response?.status
      r.erro = status ? `API do Mercado Livre respondeu ${status}` : (e as Error).message
    }
  }
  return saida
}

export interface FechamentoMes {
  mes: string // AAAA-MM
  empresa: string
  cobradoMl: number // soma dos lançamentos CDIFAL do período
  lancamentos: number
  calculado: number // soma do nosso cálculo nas notas em que o ML recolhe
  notas: number
  diferenca: number // cobrado − calculado
}

/** Fechamento por mês e empresa: o que o ML cobrou × o que calculamos para as vendas dele. */
export async function fechamentoMensal(prisma: PrismaClient, meses = 6): Promise<FechamentoMes[]> {
  const agora = new Date()
  const desde = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - (meses - 1), 1))
  const desdeStr = desde.toISOString().slice(0, 7)

  const [cobrancas, notas] = await Promise.all([
    prisma.difalCobrancaMl.findMany({ where: { periodo: { gte: `${desdeStr}-01` } } }),
    prisma.difalNota.findMany({
      // vendas em que nós pagamos a guia e mandamos o comprovante ao ML não são cobrança do ML
      where: { responsavel: 'ML_PAGA', emitidaEm: { gte: desde }, comprovanteMlEnviadoEm: null },
      select: { empresa: true, emitidaEm: true, difalCalculado: true },
    }),
  ])

  const mapa = new Map<string, FechamentoMes>()
  const linha = (mes: string, empresa: string) => {
    const k = `${mes}|${empresa}`
    if (!mapa.has(k)) mapa.set(k, { mes, empresa, cobradoMl: 0, lancamentos: 0, calculado: 0, notas: 0, diferenca: 0 })
    return mapa.get(k)!
  }
  for (const c of cobrancas) {
    const l = linha(c.periodo.slice(0, 7), c.empresa)
    l.cobradoMl += c.valor
    l.lancamentos++
  }
  for (const n of notas) {
    const l = linha(n.emitidaEm.toISOString().slice(0, 7), n.empresa)
    l.calculado += n.difalCalculado
    l.notas++
  }
  return [...mapa.values()]
    .map((l) => ({ ...l, diferenca: l.cobradoMl - l.calculado }))
    .sort((a, b) => b.mes.localeCompare(a.mes) || a.empresa.localeCompare(b.empresa))
}
