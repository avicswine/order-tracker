import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ordersApi } from '../lib/api'
import { SummaryCards } from '../components/orders/SummaryCards'
import { OrderFiltersBar } from '../components/orders/OrderFilters'
import { OrderTable } from '../components/orders/OrderTable'
import { OrderDetailModal } from '../components/orders/OrderDetailModal'
import { OrderFormModal } from '../components/orders/OrderFormModal'
import { BlingSync } from '../components/orders/BlingSync'
import { useAuth } from '../contexts/AuthContext'
import type { Order, OrderFilters } from '../types'

export function OrdersPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const [filters, setFilters] = useState<OrderFilters>({ page: 1, sortBy: 'shippedAt', sortOrder: 'desc' })
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [showForm, setShowForm] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['orders', filters],
    queryFn: () => ordersApi.list(filters),
  })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gerencie e rastreie todos os pedidos</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && <BlingSync />}
          {isAdmin && (
            <button className="btn-primary" onClick={() => setShowForm(true)}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Novo Pedido
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <SummaryCards
        filters={filters}
        onFilter={(partial) => setFilters((f) => ({ ...f, ...partial, page: 1 }))}
      />

      {/* Table */}
      <div className="card p-6 space-y-4">
        <OrderFiltersBar filters={filters} onChange={setFilters} />
        <OrderTable
          orders={data?.data ?? []}
          isLoading={isLoading}
          onViewDetails={setSelectedOrder}
          meta={data?.meta}
          onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
          sortBy={filters.sortBy}
          sortOrder={filters.sortOrder}
          onSortChange={(sortBy, sortOrder) => setFilters((f) => ({ ...f, sortBy, sortOrder, page: 1 }))}
        />
      </div>

      {/* Modals */}
      <OrderDetailModal
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
      />
      <OrderFormModal
        open={showForm}
        onClose={() => setShowForm(false)}
      />
    </div>
  )
}
