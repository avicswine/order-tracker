import { useQuery } from '@tanstack/react-query'
import { ordersApi } from '../../lib/api'
import { Spinner } from '../ui/Spinner'

const cards: { key: string; label: string; color: string; bg: string; icon: string }[] = [
  { key: 'TOTAL', label: 'Total de Pedidos', color: 'text-gray-700', bg: 'bg-gray-100', icon: '📦' },
  { key: 'PENDING', label: 'Pendentes', color: 'text-yellow-700', bg: 'bg-yellow-50', icon: '⏳' },
  { key: 'IN_TRANSIT', label: 'Em Trânsito', color: 'text-blue-700', bg: 'bg-blue-50', icon: '🚚' },
  { key: 'DELIVERED', label: 'Entregues', color: 'text-green-700', bg: 'bg-green-50', icon: '✅' },
  { key: 'CANCELLED', label: 'Cancelados', color: 'text-red-700', bg: 'bg-red-50', icon: '❌' },
  { key: 'DELAYED', label: 'Atrasados', color: 'text-orange-700', bg: 'bg-orange-50', icon: '⚠️' },
]

export function SummaryCards() {
  const { data, isLoading } = useQuery({
    queryKey: ['orders', 'summary'],
    queryFn: ordersApi.summary,
  })

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
      {cards.map((c) => (
        <div key={c.key} className={`card p-4 ${c.bg}`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xl">{c.icon}</span>
            <span className={`text-2xl font-bold ${c.color}`}>
              {data ? (data[c.key as keyof typeof data] ?? '—') : '—'}
            </span>
          </div>
          <p className={`text-xs font-medium ${c.color}`}>{c.label}</p>
        </div>
      ))}
    </div>
  )
}

export { Spinner }
