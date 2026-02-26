import { useQuery } from '@tanstack/react-query'
import { ordersApi } from '../../lib/api'
import { Spinner } from '../ui/Spinner'
import type { OrderFilters } from '../../types'

const cards: { key: string; label: string; color: string; bg: string; ring: string; icon: string }[] = [
  { key: 'TOTAL',      label: 'Total de Pedidos', color: 'text-gray-700',   bg: 'bg-gray-100',   ring: 'ring-gray-400',   icon: '📦' },
  { key: 'PENDING',    label: 'Pendentes',         color: 'text-yellow-700', bg: 'bg-yellow-50',  ring: 'ring-yellow-400', icon: '⏳' },
  { key: 'IN_TRANSIT', label: 'Em Trânsito',       color: 'text-blue-700',   bg: 'bg-blue-50',    ring: 'ring-blue-400',   icon: '🚚' },
  { key: 'DELIVERED',  label: 'Entregues',          color: 'text-green-700',  bg: 'bg-green-50',   ring: 'ring-green-400',  icon: '✅' },
  { key: 'CANCELLED',  label: 'Cancelados',         color: 'text-red-700',    bg: 'bg-red-50',     ring: 'ring-red-400',    icon: '❌' },
  { key: 'DELAYED',    label: 'Atrasados',          color: 'text-orange-700', bg: 'bg-orange-50',  ring: 'ring-orange-400', icon: '⚠️' },
]

function getActiveKey(filters: OrderFilters): string {
  if (filters.delayed) return 'DELAYED'
  if (filters.status) return filters.status
  return 'TOTAL'
}

interface Props {
  filters: OrderFilters
  onFilter: (filters: Partial<OrderFilters>) => void
}

export function SummaryCards({ filters, onFilter }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['orders', 'summary'],
    queryFn: ordersApi.summary,
  })

  const activeKey = getActiveKey(filters)

  function handleClick(key: string) {
    if (key === 'TOTAL')      onFilter({ status: '', delayed: false })
    else if (key === 'DELAYED') onFilter({ status: '', delayed: true })
    else                      onFilter({ status: key as OrderFilters['status'], delayed: false })
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <div key={c.key} className="card p-4 animate-pulse h-24" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => {
        const isActive = activeKey === c.key
        return (
          <button
            key={c.key}
            onClick={() => handleClick(c.key)}
            className={`card p-4 text-left transition-all ${c.bg} hover:brightness-95 ${
              isActive ? `ring-2 ${c.ring}` : ''
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-2xl">{c.icon}</span>
              <span className={`text-2xl font-bold ${c.color}`}>
                {data ? (data[c.key as keyof typeof data] ?? '—') : '—'}
              </span>
            </div>
            <p className={`text-xs font-medium ${c.color}`}>{c.label}</p>
          </button>
        )
      })}
    </div>
  )
}

export { Spinner }
