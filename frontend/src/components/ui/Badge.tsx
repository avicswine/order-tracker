import { STATUS_COLORS, STATUS_DOT, STATUS_LABELS } from '../../lib/utils'
import type { OrderStatus } from '../../types'

interface BadgeProps {
  status: OrderStatus
  hasOccurrence?: boolean
  lastTracking?: string | null
}

// Classifica o tipo de ocorrência pelo texto do rastreio (label específico no badge)
function occurrenceLabel(text?: string | null): string {
  const t = (text ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (t.includes('EXTRAVIO')) return 'Extravio Volume'
  if (t.includes('AVARIA')) return 'Avaria'
  if (t.includes('ROUBO') || t.includes('FURTO')) return 'Roubo/Furto'
  if (t.includes('DEVOLV') || t.includes('DEVOLUC')) return 'Devolução'
  if (t.includes('RECUSAD')) return 'Recusado'
  if (t.includes('AUSENTE')) return 'Destinatário Ausente'
  if (t.includes('ENDERECO')) return 'Endereço'
  return 'Ocorrência'
}

export function StatusBadge({ status, hasOccurrence, lastTracking }: BadgeProps) {
  // Entregue, mas teve ocorrência no caminho → "Entregue" em âmbar (resolvido com problema)
  if (status === 'DELIVERED' && hasOccurrence) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 border-amber-200" title="Entregue após ocorrência no transporte">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Entregue (c/ ocorrência)
      </span>
    )
  }

  // Ocorrência ativa (não entregue) → vermelho com o tipo
  if (hasOccurrence) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-800 border-red-200">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        {occurrenceLabel(lastTracking)}
      </span>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  )
}
