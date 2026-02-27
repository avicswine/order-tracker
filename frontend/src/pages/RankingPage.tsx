import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { carriersApi } from '../lib/api'
import type { CarrierRanking } from '../types'

type SortKey = 'total' | 'delayed' | 'delayRate' | 'deliveryRate' | 'totalNfValue' | 'avgDeliveryDays'

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function DelayBar({ rate }: { rate: number }) {
  const pctVal = Math.min(rate * 100, 100)
  const color = pctVal >= 50 ? 'bg-red-500' : pctVal >= 25 ? 'bg-orange-400' : 'bg-green-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pctVal}%` }} />
      </div>
      <span className="text-xs w-10 text-right font-medium">{pct(rate)}</span>
    </div>
  )
}

function SortButton({ label, sortKey, current, onSort }: {
  label: string
  sortKey: SortKey
  current: { key: SortKey; dir: 'asc' | 'desc' }
  onSort: (key: SortKey) => void
}) {
  const active = current.key === sortKey
  return (
    <button
      className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide select-none ${active ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <span className="text-gray-400">{active ? (current.dir === 'desc' ? '▼' : '▲') : '⇅'}</span>
    </button>
  )
}

function toDateStr(date: Date) {
  return date.toISOString().slice(0, 10)
}

function lastDays(days: number) {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  return { startDate: toDateStr(start), endDate: toDateStr(end) }
}

export function RankingPage() {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [activePreset, setActivePreset] = useState<30 | 60 | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'total', dir: 'desc' })

  function applyPreset(days: 30 | 60) {
    const { startDate: s, endDate: e } = lastDays(days)
    setStartDate(s)
    setEndDate(e)
    setActivePreset(days)
  }

  function clearFilters() {
    setStartDate('')
    setEndDate('')
    setActivePreset(null)
  }

  const params = {
    ...(startDate && { startDate }),
    ...(endDate && { endDate }),
  }

  const { data, isLoading } = useQuery({
    queryKey: ['carriers-ranking', params],
    queryFn: () => carriersApi.ranking(params),
  })

  function handleSort(key: SortKey) {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))
  }

  const sorted = [...(data ?? [])].sort((a, b) => {
    const aVal = a[sort.key] ?? -1
    const bVal = b[sort.key] ?? -1
    return sort.dir === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number)
  })

  const totals = data?.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      delivered: acc.delivered + r.delivered,
      delayed: acc.delayed + r.delayed,
      totalNfValue: acc.totalNfValue + r.totalNfValue,
    }),
    { total: 0, delivered: 0, delayed: 0, totalNfValue: 0 }
  )

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ranking de Transportadoras</h1>
          <p className="text-sm text-gray-500 mt-0.5">Desempenho comparativo por transportadora</p>
        </div>

        {/* Filtro de período */}
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex items-end gap-2">
            <button
              className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${activePreset === 30 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600'}`}
              onClick={() => applyPreset(30)}
            >
              Últimos 30 dias
            </button>
            <button
              className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${activePreset === 60 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600'}`}
              onClick={() => applyPreset(60)}
            >
              Últimos 60 dias
            </button>
          </div>
          <div>
            <label className="label">Data inicial</label>
            <input type="date" className="input w-40" value={startDate} onChange={(e) => { setStartDate(e.target.value); setActivePreset(null) }} />
          </div>
          <div>
            <label className="label">Data final</label>
            <input type="date" className="input w-40" value={endDate} onChange={(e) => { setEndDate(e.target.value); setActivePreset(null) }} />
          </div>
          {(startDate || endDate) && (
            <button className="btn-secondary" onClick={clearFilters}>
              Limpar
            </button>
          )}
        </div>
      </div>

      {/* Cards de resumo */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Total de envios</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{totals.total}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Entregues</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{totals.delivered}</p>
            <p className="text-xs text-gray-400">{totals.total > 0 ? pct(totals.delivered / totals.total) : '—'}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Atrasados</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{totals.delayed}</p>
            <p className="text-xs text-gray-400">{totals.total > 0 ? pct(totals.delayed / totals.total) : '—'}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">Valor total NFs</p>
            <p className="text-xl font-bold text-gray-900 mt-1">
              {totals.totalNfValue > 0 ? formatBRL(totals.totalNfValue) : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Transportadora</th>
                <th className="px-4 py-3 text-right">
                  <SortButton label="Envios" sortKey="total" current={sort} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-right">
                  <SortButton label="Entregues" sortKey="deliveryRate" current={sort} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-right">
                  <SortButton label="Atrasados" sortKey="delayed" current={sort} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 min-w-40">
                  <SortButton label="Taxa atraso" sortKey="delayRate" current={sort} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-right">
                  <SortButton label="Prazo médio" sortKey="avgDeliveryDays" current={sort} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-right">
                  <SortButton label="Valor NFs" sortKey="totalNfValue" current={sort} onSort={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">Carregando...</td>
                </tr>
              )}
              {!isLoading && sorted.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">Nenhum dado encontrado</td>
                </tr>
              )}
              {sorted.map((row: CarrierRanking, idx) => (
                <tr key={row.carrierId} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-400 font-medium">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{row.carrierName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {row.pending} pendente{row.pending !== 1 ? 's' : ''} · {row.inTransit} em trânsito · {row.cancelled} cancelado{row.cancelled !== 1 ? 's' : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{row.total}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-medium ${row.deliveryRate >= 0.8 ? 'text-green-600' : row.deliveryRate >= 0.5 ? 'text-orange-500' : 'text-red-500'}`}>
                      {row.delivered} <span className="text-xs text-gray-400">({pct(row.deliveryRate)})</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-medium ${row.delayed === 0 ? 'text-green-600' : row.delayRate >= 0.3 ? 'text-red-600' : 'text-orange-500'}`}>
                      {row.delayed}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <DelayBar rate={row.delayRate} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {row.avgDeliveryDays !== null ? `${row.avgDeliveryDays}d` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {row.totalNfValue > 0 ? formatBRL(row.totalNfValue) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
