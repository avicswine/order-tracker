import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { carriersApi } from '../lib/api'
import type { CarrierRanking, DelayedOrderInfo } from '../types'

type SortKey = 'total' | 'delayed' | 'delayRate' | 'deliveryRate' | 'totalNfValue' | 'avgDeliveryDays' | 'occurrences' | 'occurrenceRate'

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

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

function buildOrderTrackingUrl(
  trackingSystem: string,
  trackingIdentifier: string | null,
  senderCnpj: string | null,
  nfNumber: string | null
): string | null {
  const cnpj = senderCnpj?.replace(/\D/g, '') ?? ''
  const nf = nfNumber ? String(parseInt(nfNumber, 10)) : ''
  switch (trackingSystem) {
    case 'SSW':
      return `https://ssw.inf.br/2/resultSSW?cnpj=${cnpj}&NR=${nf}`
    case 'SAO_MIGUEL':
    case 'PUPPETEER':
      return 'https://portaldocliente.expressosaomiguel.com.br/rastrear-mercadoria'
    case 'RODONAVES':
      return `https://www.rodonaves.com.br/rastreio-de-mercadoria?taxIdRegistration=${cnpj}&invoiceNumber=${nf}`
    case 'BRASPRESS':
      return `https://blue.braspress.com/site/w/tracking/find?cpfCnpj=${cnpj}&pedidoNf=${nf}`
    case 'SENIOR':
      return trackingIdentifier ? `https://${trackingIdentifier}.senior.com.br/rastreamento` : null
    default:
      return null
  }
}

function DelayedCell({ count, orders, trackingSystem, trackingIdentifier }: { count: number; orders: DelayedOrderInfo[]; trackingSystem: string; trackingIdentifier: string | null }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  function show() {
    if (timer.current) clearTimeout(timer.current)
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setPos({ top: r.top + window.scrollY, left: r.left + r.width / 2 + window.scrollX })
    }
  }

  function hide() {
    timer.current = setTimeout(() => setPos(null), 150)
  }

  // fecha ao rolar a página
  useEffect(() => {
    if (!pos) return
    const onScroll = () => setPos(null)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [pos])

  if (count === 0) return <span className="font-medium text-green-600">0</span>

  const tooltip = pos && createPortal(
    <div
      className="fixed z-[9999]"
      style={{ top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
      onMouseEnter={() => { if (timer.current) clearTimeout(timer.current) }}
      onMouseLeave={hide}
    >
      {/* seta */}
      <div className="flex justify-center">
        <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-b-[6px] border-l-transparent border-r-transparent border-b-gray-900" />
      </div>
      <div className="bg-gray-900 text-white rounded-lg shadow-xl text-xs overflow-hidden" style={{ minWidth: '440px' }}>
        <div className="px-4 py-2 border-b border-gray-700 font-semibold text-gray-300">
          {orders.length} pedido{orders.length !== 1 ? 's' : ''} atrasado{orders.length !== 1 ? 's' : ''}
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-gray-700">
          {orders.map((o, i) => (
            <div key={i} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono font-semibold text-white whitespace-nowrap">{o.nfNumber ?? '—'}</span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="bg-red-600 text-white font-bold px-2 py-0.5 rounded whitespace-nowrap">
                    +{o.daysDelayed}d atraso
                  </span>
                  {(() => {
                    const url = buildOrderTrackingUrl(trackingSystem, trackingIdentifier, o.senderCnpj, o.nfNumber)
                    return url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-2 py-0.5 rounded whitespace-nowrap transition-colors"
                      >
                        RASTREIO
                      </a>
                    ) : null
                  })()}
                </div>
              </div>
              <p className="text-gray-200 mt-1">{o.customerName}</p>
              <div className="flex gap-4 mt-1 text-gray-400">
                <span className="whitespace-nowrap">Envio: {fmtDate(o.shippedAt)}</span>
                <span className="whitespace-nowrap">Previsão: {fmtDate(o.estimatedDelivery)}</span>
                {o.deliveredAt && (
                  <span className="whitespace-nowrap">Entregue: {fmtDate(o.deliveredAt)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )

  return (
    <>
      <div ref={triggerRef} className="inline-block" onMouseEnter={show} onMouseLeave={hide}>
        <span className="font-medium cursor-default text-red-600">{count}</span>
      </div>
      {tooltip}
    </>
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
  const [startDate, setStartDate] = useState(() => lastDays(20).startDate)
  const [endDate, setEndDate] = useState(() => lastDays(20).endDate)
  const [activePreset, setActivePreset] = useState<number | null>(20)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'total', dir: 'desc' })

  function applyPreset(days: number) {
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
        <div className="flex items-center gap-2 flex-wrap">
          {[10, 20, 30, 60, 90].map((days) => (
            <button
              key={days}
              onClick={() => activePreset === days ? clearFilters() : applyPreset(days)}
              className={`px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
                activePreset === days
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400 hover:text-blue-600'
              }`}
            >
              {days} dias
            </button>
          ))}
          {activePreset && (
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
                  <SortButton label="Média atraso" sortKey="avgDeliveryDays" current={sort} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-right">
                  <SortButton label="Ocorrências" sortKey="occurrences" current={sort} onSort={handleSort} />
                </th>
                <th className="px-4 py-3 text-right">
                  <SortButton label="Valor NFs" sortKey="totalNfValue" current={sort} onSort={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400">Carregando...</td>
                </tr>
              )}
              {!isLoading && sorted.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-gray-400">Nenhum dado encontrado</td>
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
                    <DelayedCell count={row.delayed} orders={row.delayedOrders ?? []} trackingSystem={row.trackingSystem} trackingIdentifier={row.trackingIdentifier} />
                  </td>
                  <td className="px-4 py-3">
                    <DelayBar rate={row.delayRate} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">
                    {row.avgDeliveryDays !== null ? `+${row.avgDeliveryDays}d` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {row.occurrences > 0 ? (
                      <span className="font-medium text-orange-600">
                        {row.occurrences}
                        <span className="ml-1 text-xs text-gray-400">({pct(row.occurrenceRate)})</span>
                      </span>
                    ) : (
                      <span className="text-green-600 font-medium">0</span>
                    )}
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
