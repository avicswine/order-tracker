import { useState } from 'react'

const API_URL = typeof window !== 'undefined' ? window.location.origin : ''

type OrderStatus = 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED'

interface TrackingEvent {
  date: string | null
  description: string
}

interface Order {
  orderNumber: string
  nfNumber: string | null
  nfValue: number | null
  nfIssuedAt: string | null
  customerName: string | null
  status: OrderStatus
  shippedAt: string | null
  estimatedDelivery: string | null
  deliveredAt: string | null
  lastTracking: string | null
  lastTrackingAt: string | null
  carrierName: string | null
  trackingEvents: TrackingEvent[] | null
  hasOccurrence?: boolean
}

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: 'Pendente',
  IN_TRANSIT: 'Em Trânsito',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
}

const STATUS_STYLE: Record<OrderStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  IN_TRANSIT: 'bg-blue-100 text-blue-700',
  DELIVERED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-600',
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR')
}

function formatCurrency(value: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function maskDocument(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 11) {
    // CPF: 000.000.000-00
    if (d.length > 9) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9)
    if (d.length > 6) return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6)
    if (d.length > 3) return d.slice(0, 3) + '.' + d.slice(3)
    return d
  }
  // CNPJ: 00.000.000/0000-00
  if (d.length > 12) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12)
  if (d.length > 8)  return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8)
  if (d.length > 5)  return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5)
  if (d.length > 2)  return d.slice(0, 2) + '.' + d.slice(2)
  return d
}

function isDelayed(order: Order): boolean {
  if (order.status === 'DELIVERED' || order.status === 'CANCELLED') return false
  if (!order.estimatedDelivery) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const est = new Date(order.estimatedDelivery)
  est.setHours(0, 0, 0, 0)
  return today > est
}

const OCCURRENCE_KEYWORDS = ['EXTRAVIO', 'AVARIA', 'ROUBO', 'FURTO', 'DANO', 'SINISTRO', 'DIVERGENCIA', 'NAO ENTREGUE', 'ENTREGA NAO', 'RECUSADO', 'DEVOLVIDO', 'ENDERECO', 'AUSENTE', 'CANCELADO', 'PREJUDICADO', 'PROBLEMA', 'IMPEDIDO']

function formatTrackingText(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ])([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ][a-záéíóúàâêôãõç])/, '$1 - $2')
}

function isOccurrence(text: string): boolean {
  const t = text.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return OCCURRENCE_KEYWORDS.some(k => t.includes(k))
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function OrderCard({ order }: { order: Order }) {
  const delayed = isDelayed(order)
  const events = Array.isArray(order.trackingEvents) ? order.trackingEvents : []
  const isDeliveredEvent = (desc: string) => {
    const t = desc.toUpperCase()
    return t.includes('ENTREGUE') || t.includes('ENTREGA REALIZADA') || t.includes('ENTREGA EFETUADA')
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Cabecalho */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <span className="text-xs text-gray-400 uppercase tracking-wide">NF</span>
          <p className="font-semibold text-gray-800 text-lg leading-tight font-mono">
            {order.nfNumber ? String(parseInt(order.nfNumber, 10)) : order.orderNumber}
          </p>
          {order.carrierName && (
            <p className="text-xs text-gray-500 mt-0.5">{order.carrierName}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLE[order.status]}`}>
            {STATUS_LABEL[order.status]}
          </span>
          {delayed && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-orange-100 text-orange-600">
              Entrega em atraso
            </span>
          )}
          {order.hasOccurrence && (
            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-orange-100 text-orange-700">
              ⚠️ Intercorrencia
            </span>
          )}
        </div>
      </div>

      {/* Datas e valor */}
      <div className="grid grid-cols-2 gap-3 bg-gray-50 px-5 py-3 border-b border-gray-100 text-sm">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Emissao da NF</p>
          <p className="font-medium text-gray-700">{formatDate(order.nfIssuedAt)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Valor da NF</p>
          <p className="font-medium text-gray-700">{formatCurrency(order.nfValue)}</p>
        </div>
        {order.shippedAt && (
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Data de Envio</p>
            <p className="font-medium text-gray-700">{formatDate(order.shippedAt)}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-400 mb-0.5">
            {order.status === 'DELIVERED' ? 'Entregue em' : 'Previsao de Entrega'}
          </p>
          <p className={`font-medium ${delayed ? 'text-orange-600' : 'text-gray-700'}`}>
            {order.status === 'DELIVERED'
              ? formatDate(order.deliveredAt)
              : formatDate(order.estimatedDelivery)}
            {delayed && (() => {
              const today = new Date(); today.setHours(0, 0, 0, 0)
              const dias = Math.floor((today.getTime() - new Date(order.estimatedDelivery!).setHours(0, 0, 0, 0)) / 86400000)
              return <span className="ml-1.5 text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">{dias}d</span>
            })()}
          </p>
        </div>
      </div>

      {/* Rastreamento */}
      {events.length > 0 ? (
        <div className="px-5 py-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Rastreamento</p>
          <div className="space-y-0 max-h-56 overflow-y-auto">
            {events.map((ev, i) => {
              const isFirst = i === 0
              const isLast = i === events.length - 1
              const occ = isOccurrence(ev.description)
              const delivered = isDeliveredEvent(ev.description)
              const dotColor = occ ? 'bg-orange-400' : delivered ? 'bg-green-500' : isFirst ? 'bg-blue-500' : 'bg-gray-300'
              return (
                <div key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`h-2.5 w-2.5 rounded-full mt-1 flex-shrink-0 ${dotColor}`} />
                    {!isLast && <div className="w-px flex-1 bg-gray-200 mt-1 mb-0" />}
                  </div>
                  <div className={`pb-3 ${isFirst ? '' : 'opacity-75'}`}>
                    <p className={`text-sm font-medium ${occ ? 'text-orange-700' : delivered ? 'text-green-700' : 'text-gray-800'}`}>
                      {formatTrackingText(ev.description)}
                    </p>
                    {ev.date && (
                      <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(ev.date)}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : order.lastTracking ? (
        <div className={`mx-5 my-4 rounded-lg p-3 ${isOccurrence(order.lastTracking) ? 'bg-orange-50 border border-orange-200' : 'bg-blue-50 border border-blue-100'}`}>
          <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${isOccurrence(order.lastTracking) ? 'text-orange-600' : 'text-blue-600'}`}>
            {isOccurrence(order.lastTracking) ? '⚠️ Intercorrencia' : 'Ultimo Rastreio'}
          </p>
          <p className={`text-sm font-medium ${isOccurrence(order.lastTracking) ? 'text-orange-800' : 'text-blue-800'}`}>
            {formatTrackingText(order.lastTracking)}
          </p>
          {order.lastTrackingAt && (
            <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(order.lastTrackingAt)}</p>
          )}
        </div>
      ) : (
        <div className="px-5 py-4 text-sm text-gray-400 italic">
          Rastreamento ainda nao disponivel.
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [doc, setDoc] = useState('')
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const digits = doc.replace(/\D/g, '')
    if (digits.length !== 11 && digits.length !== 14) {
      setError('Informe um CPF ou CNPJ valido.')
      return
    }
    setLoading(true)
    setError(null)
    setOrders(null)
    setSearched(true)
    try {
      const res = await fetch(`${API_URL}/api/public/tracking?document=${digits}`)
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? `Erro ${res.status}`)
      }
      const data = await res.json() as Order[]
      setOrders(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-gray-800">Rastreamento de Pedidos</h1>
          <p className="text-gray-500 text-sm mt-1">
            Digite seu CNPJ ou CPF para visualizar suas entregas
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <form onSubmit={handleSearch} className="flex gap-3 mb-8">
          <input
            type="text"
            value={doc}
            onChange={e => setDoc(maskDocument(e.target.value))}
            placeholder="000.000.000-00 ou 00.000.000/0000-00"
            className="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium px-6 py-3 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
        </form>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm mb-6">
            {error}
          </div>
        )}

        {orders !== null && (
          <>
            {orders.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg">Nenhum pedido encontrado</p>
                <p className="text-sm mt-1">Verifique se o documento informado esta correto.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-4">
                  {orders.length} {orders.length === 1 ? 'pedido encontrado' : 'pedidos encontrados'}
                  {' · '}
                  <span className="text-gray-400">Atualizado a cada 2 horas</span>
                </p>
                <div className="space-y-4">
                  {orders.map(order => (
                    <OrderCard key={order.orderNumber} order={order} />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {!searched && (
          <p className="text-center text-gray-400 text-sm mt-8">
            As informacoes sao atualizadas automaticamente a cada 2 horas.
          </p>
        )}
      </div>
    </div>
  )
}
