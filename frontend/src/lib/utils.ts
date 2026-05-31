import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { Order, OrderStatus, TrackingSystem } from '../types'

export function getTrackingUrl(order: Order): string | null {
  const system = order.carrier?.trackingSystem
  const cnpj = order.senderCnpj?.replace(/\D/g, '') ?? ''
  const nf = order.nfNumber ? String(parseInt(order.nfNumber, 10)) : ''

  switch (system as TrackingSystem) {
    case 'SSW':
      // SSW aceita parâmetros via query string na página de consulta
      return `https://ssw.inf.br/2/resultSSW?cnpj=${cnpj}&NR=${nf}`
    case 'SAO_MIGUEL':
    case 'PUPPETEER':
      return 'https://portaldocliente.expressosaomiguel.com.br/rastrear-mercadoria'
    case 'RODONAVES':
      return `https://www.rodonaves.com.br/rastreio-de-mercadoria?taxIdRegistration=${cnpj}&invoiceNumber=${nf}`
    case 'BRASPRESS':
      return `https://blue.braspress.com/site/w/tracking/find?cpfCnpj=${cnpj}&pedidoNf=${nf}`
    case 'SENIOR':
      return `https://platform.senior.com.br/logistica-tck/tms/tck-frontend/#/login/signup?tenant=ZEhKa2RISmhibk53YjNKMFpYTT0%3D`
    case 'ATUAL_CARGAS':
      return 'https://cliente.atualcargas.com.br'
    default:
      // Se trackingIdentifier for uma URL, usa como link de rastreio manual
      if (order.carrier?.trackingIdentifier?.startsWith('http')) {
        return order.carrier.trackingIdentifier
      }
      return null
  }
}

export function formatDate(date: string | null | undefined, fmt = 'dd/MM/yyyy') {
  if (!date) return '—'
  try {
    return format(parseISO(date), fmt, { locale: ptBR })
  } catch {
    return '—'
  }
}

export function formatDateTime(date: string | null | undefined) {
  return formatDate(date, "dd/MM/yyyy 'às' HH:mm")
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: 'Pendente',
  IN_TRANSIT: 'Em Trânsito',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
}

export const STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  IN_TRANSIT: 'bg-blue-100 text-blue-800 border-blue-200',
  DELIVERED: 'bg-green-100 text-green-800 border-green-200',
  CANCELLED: 'bg-red-100 text-red-800 border-red-200',
}

export const STATUS_DOT: Record<OrderStatus, string> = {
  PENDING: 'bg-yellow-400',
  IN_TRANSIT: 'bg-blue-500',
  DELIVERED: 'bg-green-500',
  CANCELLED: 'bg-red-500',
}

export function formatCNPJ(value: string) {
  return value
    .replace(/\D/g, '')
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
    .slice(0, 18)
}

export const SENDER_COMPANIES = [
  { cnpj: '47.715.256/0001-49', name: 'AVIC', color: 'bg-black text-white' },
  { cnpj: '54.695.386/0001-22', name: 'AGRO', color: 'bg-red-600 text-white' },
  { cnpj: '56.633.474/0001-25', name: 'EQUI', color: 'bg-orange-500 text-white' },
]

const OCCURRENCE_KEYWORDS = [
  'TENTATIVA DE ENTREGA', 'DESTINATÁRIO AUSENTE', 'ENDEREÇO NÃO ENCONTRADO',
  'ENDERECO NAO ENCONTRADO', 'ENDEREÇO INCORRETO', 'ESTABELECIMENTO FECHADO',
  'AVARIA', 'EXTRAVIO', 'RETIDO', 'RECUSADO', 'SUSTADO', 'IMPEDIMENTO',
  'OCORRENCIA',
]

export function isOccurrenceEvent(text: string | null | undefined): boolean {
  if (!text) return false
  const t = text.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (t.includes('SEM OCORRENCIA') || t.includes('OCORRENCIA DE ENTREGA')) return false
  return OCCURRENCE_KEYWORDS.some((kw) =>
    t.includes(kw.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
  )
}

export function formatPhone(value: string) {
  return value
    .replace(/\D/g, '')
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{4,5})(\d{4})$/, '$1-$2')
    .slice(0, 15)
}

// Insere " - " onde uma palavra toda em MAIÚSCULAS se concatena diretamente com a próxima
// Ex: "SAIDA DE UNIDADESaida" → "SAIDA DE UNIDADE - Saida"
// Ex: "MERCADORIA ENTREGUECTRC ENTREGUE" → "MERCADORIA ENTREGUE - CTRC ENTREGUE"
// Ex: "(SSWMOBILE) Comprovante" → "(SSWMOBILE) - Comprovante"
export function formatTrackingText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    // Separador 1: palavra ≥3 maiúsculas concatenada diretamente com próxima palavra
    .replace(/([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ]{3,})([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ(0-9])/, '$1 - $2')
    // Separador 2: ) seguido de espaço + Palavra com inicial maiúscula
    .replace(/\)\s+([A-Z][a-záéíóúàâêôãõç])/, ') - $1')
}
