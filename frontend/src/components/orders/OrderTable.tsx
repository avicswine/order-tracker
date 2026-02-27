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
                  <div className="flex items-center gap-1.5">
                    <p className="font-medium text-gray-900">{order.customerName}</p>
                    {order.customerPhone && (
                      <a
                        href={`https://wa.me/55${order.customerPhone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`WhatsApp: ${order.customerPhone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex-shrink-0 text-green-500 hover:text-green-600"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.555 4.112 1.527 5.836L.057 23.487l5.773-1.516A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.891 0-3.659-.494-5.192-1.358l-.372-.222-3.427.9.916-3.343-.243-.386A9.937 9.937 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                        </svg>
                      </a>
                    )}
                  </div>
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
