import type { Order } from '../../types'
import { StatusBadge } from '../ui/Badge'
import { formatDate, isOccurrenceEvent, SENDER_COMPANIES } from '../../lib/utils'
import { Spinner } from '../ui/Spinner'

interface Props {
  orders: Order[]
  isLoading: boolean
  onViewDetails: (order: Order) => void
  meta: { total: number; page: number; limit: number; totalPages: number } | undefined
  onPageChange: (page: number) => void
  sortBy?: 'shippedAt' | 'estimatedDelivery'
  sortOrder?: 'asc' | 'desc'
  onSortChange: (sortBy: 'shippedAt' | 'estimatedDelivery', sortOrder: 'asc' | 'desc') => void
}

export function OrderTable({ orders, isLoading, onViewDetails, meta, onPageChange, sortBy, sortOrder, onSortChange }: Props) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  function handleSort(col: 'shippedAt' | 'estimatedDelivery') {
    if (sortBy === col) {
      onSortChange(col, sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      onSortChange(col, 'asc')
    }
  }

  function SortIcon({ col }: { col: 'shippedAt' | 'estimatedDelivery' }) {
    if (sortBy !== col) return <span className="ml-1 text-gray-300">↕</span>
    return <span className="ml-1 text-blue-500">{sortOrder === 'asc' ? '↑' : '↓'}</span>
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
        <svg className="h-12 w-12 mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="font-medium">Nenhum pedido encontrado</p>
        <p className="text-sm">Tente ajustar os filtros aplicados</p>
      </div>
    )
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left">
              <th className="pb-3 pr-4 font-medium text-gray-500">NF</th>
              <th className="pb-3 pr-4 font-medium text-gray-500">Empresa</th>
              <th className="pb-3 pr-4 font-medium text-gray-500">Cliente</th>
              <th className="pb-3 pr-4 font-medium text-gray-500">Transportadora</th>
              <th className="pb-3 pr-4 font-medium text-gray-500">Status</th>
              <th className="pb-3 pr-4 font-medium text-gray-500">
                <button onClick={() => handleSort('shippedAt')} className="flex items-center hover:text-gray-800 transition-colors">
                  Envio<SortIcon col="shippedAt" />
                </button>
              </th>
              <th className="pb-3 pr-4 font-medium text-gray-500">
                <button onClick={() => handleSort('estimatedDelivery')} className="flex items-center hover:text-gray-800 transition-colors">
                  Previsão<SortIcon col="estimatedDelivery" />
                </button>
              </th>
              <th className="pb-3 font-medium text-gray-500" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {orders.map((order) => (
              <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                <td className="py-3 pr-4 font-mono font-medium text-gray-900">{order.nfNumber ?? '—'}</td>
                <td className="py-3 pr-4">
                  {order.senderCnpj ? (() => {
                    const company = SENDER_COMPANIES.find((c) => c.cnpj === order.senderCnpj)
                    return (
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${company?.color ?? 'bg-gray-100 text-gray-700'}`}>
                        {company?.name ?? order.senderCnpj}
                      </span>
                    )
                  })() : '—'}
                </td>
                <td className="py-3 pr-4">
                  <p className="font-medium text-gray-900">{order.customerName}</p>
                  {order.customerEmail && (
                    <p className="text-xs text-gray-500">{order.customerEmail}</p>
                  )}
                </td>
                <td className="py-3 pr-4">
                  {order.carrier ? (
                    <span className={`text-gray-700 ${!order.carrier.active ? 'opacity-60' : ''}`}>
                      {order.carrier.name}
                      {!order.carrier.active && <span className="ml-1 text-xs text-gray-400">(inativa)</span>}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-600 font-medium">A definir</span>
                  )}
                </td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={order.status} />
                    {isOccurrenceEvent(order.lastTracking) && (
                      <span title={order.lastTracking ?? ''} className="text-orange-500 cursor-help" aria-label="Intercorrência">⚠️</span>
                    )}
                  </div>
                </td>
                <td className="py-3 pr-4 text-gray-600">{formatDate(order.shippedAt)}</td>
                <td className="py-3 pr-4">
                  {order.estimatedDelivery ? (
                    <span className={
                      order.status !== 'DELIVERED' && order.status !== 'CANCELLED' &&
                      new Date(order.estimatedDelivery) < today
                        ? 'text-orange-600 font-medium'
                        : 'text-gray-600'
                    }>
                      {formatDate(order.estimatedDelivery)}
                      {order.status !== 'DELIVERED' && order.status !== 'CANCELLED' &&
                       new Date(order.estimatedDelivery) < today && (
                        <span className="ml-1 text-xs bg-orange-100 text-orange-700 px-1 py-0.5 rounded">
                          atrasado
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>
                <td className="py-3 text-right">
                  <button
                    onClick={() => onViewDetails(order)}
                    className="text-blue-600 hover:text-blue-800 font-medium text-xs"
                  >
                    Detalhes
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta && meta.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <p className="text-sm text-gray-500">
            {(meta.page - 1) * meta.limit + 1}–{Math.min(meta.page * meta.limit, meta.total)} de{' '}
            {meta.total} pedidos
          </p>
          <div className="flex gap-1">
            <button
              className="btn-secondary px-2 py-1 text-xs"
              disabled={meta.page === 1}
              onClick={() => onPageChange(meta.page - 1)}
            >
              ‹ Anterior
            </button>
            {Array.from({ length: Math.min(meta.totalPages, 7) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`w-8 h-8 rounded text-xs font-medium transition-colors ${
                  p === meta.page
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {p}
              </button>
            ))}
            <button
              className="btn-secondary px-2 py-1 text-xs"
              disabled={meta.page === meta.totalPages}
              onClick={() => onPageChange(meta.page + 1)}
            >
              Próximo ›
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
