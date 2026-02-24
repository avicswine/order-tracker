import axios from 'axios'
import * as cheerio from 'cheerio'
import { OrderStatus } from '@prisma/client'

export interface TrackingResult {
  status: OrderStatus | null
  lastEvent: string | null
  raw?: unknown
}

// Mapeia texto de ocorrência para nosso enum de status
function mapStatus(text: string): OrderStatus | null {
  const t = text.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (t.includes('ENTREGUE') || t.includes('ENTREGA REALIZADA') || t.includes('ENTREGA EFETUADA')) return OrderStatus.DELIVERED
  if (t.includes('DEVOLV') || t.includes('RETORNO') || t.includes('CANCELAD')) return OrderStatus.CANCELLED
  if (
    t.includes('SAIU PARA ENTREGA') || t.includes('EM ROTA') || t.includes('SAIDA PARA ENTREGA') ||
    t.includes('EM TRANSITO') || t.includes('TRANSFERENCIA') || t.includes('COLETADO') ||
    t.includes('COLETA REALIZADA') || t.includes('EXPEDIDO') || t.includes('EM DISTRIBUICAO')
  ) return OrderStatus.IN_TRANSIT
  return null
}

// --- SSW ---
export async function trackSSW(
  senderCnpj: string,
  nfNumber: string,
  siglaEmp?: string
): Promise<TrackingResult> {
  const cnpj = senderCnpj.replace(/\D/g, '')
  const nf = String(parseInt(nfNumber, 10)) // remove zeros à esquerda

  const params = new URLSearchParams({ cnpj, NR: nf })
  if (siglaEmp) params.append('sigla_emp', siglaEmp)

  const response = await axios.post('https://ssw.inf.br/2/ssw_resultSSW', params, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  })

  const $ = cheerio.load(response.data as string)

  // Estrutura SSW: tabela com 3 colunas — "N Fiscal | Unidade/Data | Situação"
  // Linha de header tem cells[2] = "Situação", linhas de dados têm o status real
  let lastEvent: string | null = null
  const SKIP = ['situação', 'download em csv', 'remetente', 'voltar', 'n fiscal']

  $('table tr').each((_i, row) => {
    const cells = $(row).find('td')
    if (cells.length === 3) {
      const situacao = $(cells[2]).text().trim()
      const situacaoLower = situacao.toLowerCase()
      if (situacao && !SKIP.some((s) => situacaoLower.includes(s))) {
        lastEvent = situacao
      }
    }
  })

  return {
    status: lastEvent ? mapStatus(lastEvent) : null,
    lastEvent,
  }
}

// --- Senior TCK ---
export async function trackSenior(
  senderCnpj: string,
  nfNumber: string,
  tenant: string
): Promise<TrackingResult> {
  const cnpj = senderCnpj.replace(/\D/g, '')
  const nf = String(parseInt(nfNumber, 10))

  const response = await axios.post(
    'https://platform.senior.com.br/t/senior.com.br/bridge/1.0/anonymous/rest/tms/tck/actions/externalTenantConsultaTracking',
    { inscricaoFiscal: cnpj, documento: nf },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': tenant,
        'X-TenantDomain': `${tenant}.senior.com.br`,
      },
      timeout: 15000,
    }
  )

  const data = response.data as { listaTracking?: unknown[]; trackings?: unknown[]; totalRegistros?: number }

  // Senior retorna: { listaTracking: [...], totalRegistros: N }
  const list = data.listaTracking ?? data.trackings ?? []

  let lastEvent: string | null = null

  if (Array.isArray(list) && list.length > 0) {
    const last = list[list.length - 1] as Record<string, unknown>
    lastEvent =
      (last.situacao as string) ??
      (last.descricao as string) ??
      (last.fase as string) ??
      (last.status as string) ??
      null
  }

  return {
    status: lastEvent ? mapStatus(lastEvent) : null,
    lastEvent,
  }
}
