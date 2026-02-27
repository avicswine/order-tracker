import { useQuery } from '@tanstack/react-query'
import type { OrderFilters, OrderStatus } from '../../types'
import { STATUS_LABELS, SENDER_COMPANIES } from '../../lib/utils'
import { carriersApi } from '../../lib/api'

const STATUS_OPTIONS: { value: OrderStatus | ''; label: string }[] = [
  { value: '', label: 'Todos os status' },
  { value: 'PENDING', label: STATUS_LABELS.PENDING },
  { value: 'IN_TRANSIT', label: STATUS_LABELS.IN_TRANSIT },
  { value: 'DELIVERED', label: STATUS_LABELS.DELIVERED },
  { value: 'CANCELLED', label: STATUS_LABELS.CANCELLED },
]

interface Props {
  filters: OrderFilters
  onChange: (filters: OrderFilters) => void
}

export function OrderFiltersBar({ filters, onChange }: Props) {
  const { data: carriers } = useQuery({ queryKey: ['carriers'], queryFn: carriersApi.list })

  return (
    <div className="flex flex-wrap gap-3 items-end">
      {/* Search */}
      <div className="flex-1 min-w-48">
        <label className="label">Buscar</label>
        <div className="relative">
          <svg className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Nº pedido ou cliente..."
            className="input pl-9"
            value={filters.search ?? ''}
            onChange={(e) => onChange({ ...filters, search: e.target.value, page: 1 })}
          />
        </div>
      </div>

      {/* Status */}
      <div className="w-44">
        <label className="label">Status</label>
        <select
          className="input"
          value={filters.status ?? ''}
          onChange={(e) => onChange({ ...filters, status: e.target.value as OrderStatus | '', page: 1 })}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Date range */}
      <div className="w-40">
        <label className="label">Data inicial</label>
        <input
          type="date"
          className="input"
          value={filters.startDate ?? ''}
          onChange={(e) => onChange({ ...filters, startDate: e.target.value, page: 1 })}
        />
      </div>
      <div className="w-40">
        <label className="label">Data final</label>
        <input
          type="date"
          className="input"
          value={filters.endDate ?? ''}
          onChange={(e) => onChange({ ...filters, endDate: e.target.value, page: 1 })}
        />
      </div>

      {/* Empresa */}
      <div className="w-44">
        <label className="label">Empresa</label>
        <select
          className="input"
          value={filters.senderCnpj ?? ''}
          onChange={(e) => onChange({ ...filters, senderCnpj: e.target.value, page: 1 })}
        >
          <option value="">Todas</option>
          {SENDER_COMPANIES.map((c) => (
            <option key={c.cnpj} value={c.cnpj}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Transportadora */}
      <div className="w-44">
        <label className="label">Transportadora</label>
        <select
          className="input"
          value={filters.carrierId ?? ''}
          onChange={(e) => onChange({ ...filters, carrierId: e.target.value, page: 1 })}
        >
          <option value="">Todas</option>
          {carriers?.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {/* Nº da NF */}
      <div className="w-36">
        <label className="label">Nº da NF</label>
        <input
          type="text"
          placeholder="000000"
          className="input"
          value={filters.nfNumber ?? ''}
          onChange={(e) => onChange({ ...filters, nfNumber: e.target.value, page: 1 })}
        />
      </div>

      {/* Atrasados */}
      <div className="flex items-end pb-0.5">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300 text-orange-600 focus:ring-orange-500"
            checked={filters.delayed === true}
            onChange={(e) => onChange({ ...filters, delayed: e.target.checked || undefined, page: 1 })}
          />
          <span className="text-sm font-medium text-orange-700">Só atrasados</span>
        </label>
      </div>

      {/* Clear */}
      {(filters.search || filters.status || filters.startDate || filters.endDate || filters.senderCnpj || filters.carrierId || filters.nfNumber || filters.delayed) && (
        <button
          className="btn-secondary"
          onClick={() => onChange({ page: 1 })}
        >
          Limpar filtros
        </button>
      )}
    </div>
  )
}
