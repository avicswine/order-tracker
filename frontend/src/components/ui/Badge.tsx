import { STATUS_COLORS, STATUS_DOT, STATUS_LABELS } from '../../lib/utils'
import type { OrderStatus } from '../../types'

interface BadgeProps {
  status: OrderStatus
  hasOccurrence?: boolean
}

export function StatusBadge({ status, hasOccurrence }: BadgeProps) {
  if (hasOccurrence) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-800 border-red-200">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Ocorrência
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
