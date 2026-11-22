import { useQuery } from '@tanstack/react-query'
import { ordersApi } from '../../lib/api'
import { Spinner } from '../ui/Spinner'
import type { OrderFilters } from '../../types'
import { STATUS_TOM, TOM_ATRASADO } from '../../lib/utils'
import { TOM, type Tom } from '../../lib/estilo'

// cor de cada card = cor do status (a mesma dos selos, em lib/estilo.ts)
const cards: { key: string; label: string; tom: Tom }[] = [
  { key: 'TOTAL',      label: 'Total de pedidos', tom: 'cinza' },
  { key: 'PENDING',    label: 'Faturados',        tom: STATUS_TOM.PENDING },
  { key: 'IN_TRANSIT', label: 'Em trânsito',      tom: STATUS_TOM.IN_TRANSIT },
  { key: 'DELIVERED',  label: 'Entregues',        tom: STATUS_TOM.DELIVERED },
  { key: 'CANCELLED',  label: 'Cancelados',       tom: STATUS_TOM.CANCELLED },
  { key: 'DELAYED',    label: 'Atrasados',        tom: TOM_ATRASADO },
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
  const shippedStartDate = filters.shippedStartDate
  const nfStartDate = filters.nfStartDate
  const { data, isLoading } = useQuery({
    queryKey: ['orders', 'summary', shippedStartDate, nfStartDate],
    queryFn: () => {
      const params: { shippedStartDate?: string; nfStartDate?: string } = {}
      if (shippedStartDate) params.shippedStartDate = shippedStartDate
      if (nfStartDate) params.nfStartDate = nfStartDate
      return ordersApi.summary(Object.keys(params).length ? params : undefined)
    },
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
          <div key={c.key} className="resumo h-24 animate-pulse" />
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
            className={`resumo resumo-clicavel text-left ${isActive ? 'resumo-ativo' : ''}`}
          >
            <p className="resumo-rotulo flex items-center gap-1.5">
              <span className={`selo-ponto ${TOM[c.tom].ponto}`} />
              {c.label}
            </p>
            <p className={`resumo-valor ${c.key === 'TOTAL' ? '' : TOM[c.tom].texto}`}>
              {data ? (data[c.key as keyof typeof data] ?? '—') : '—'}
            </p>
          </button>
        )
      })}
    </div>
  )
}

export { Spinner }
