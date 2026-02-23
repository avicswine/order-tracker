import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import type { OrderStatus } from '../types'

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
  { cnpj: '47.715.256/0001-49', name: 'Avic' },
  { cnpj: '54.695.386/0001-22', name: 'Agrogranja' },
  { cnpj: '56.633.474/0001-25', name: 'Equipage' },
]

export function formatPhone(value: string) {
  return value
    .replace(/\D/g, '')
    .replace(/^(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{4,5})(\d{4})$/, '$1-$2')
    .slice(0, 15)
}
