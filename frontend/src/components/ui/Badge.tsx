import { STATUS_COLORS, STATUS_DOT, STATUS_LABELS } from '../../lib/utils'
import type { OrderStatus } from '../../types'

interface BadgeProps {
  status: OrderStatus
}

export function StatusBadge({ status }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABELS[status]}
    </span>
  )
}
