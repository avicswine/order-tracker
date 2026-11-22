import { useState } from 'react'
import { STATUS_TOM, TOM, TOM_ATRASADO, TOM_OCORRENCIA, seloTom } from '../../frontend/src/lib/estilo'

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
  PENDING: 'Faturado',
  IN_TRANSIT: 'Em Trânsito',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
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
  return text
    .replace(/([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ]{3,})([A-ZÁÉÍÓÚÀÂÊÔÃÕÇ(0-9])/, '$1 - $2')
    .replace(/\)\s+([A-Z][a-záéíóúàâêôãõç])/, ') - $1')
}

function isOccurrence(text: string): boolean {
  const t = text.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return OCCURRENCE_KEYWORDS.some(k => t.includes(k))
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' às ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function OrderCard({ order }: { order: Order }) {
  const delayed = isDelayed(order)
  const events = Array.isArray(order.trackingEvents) ? order.trackingEvents : []
  const isDeliveredEvent = (desc: string) => {
    const t = desc.toUpperCase()
    return t.includes('ENTREGUE') || t.includes('ENTREGA REALIZADA') || t.includes('ENTREGA EFETUADA')
  }

  return (
    <div className="card overflow-hidden">
      {/* Cabecalho */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <span className="resumo-rotulo">NF</span>
          <p className="font-mono text-lg font-semibold leading-tight text-slate-900">
            {order.nfNumber ? String(parseInt(order.nfNumber, 10)) : order.orderNumber}
          </p>
          {order.carrierName && (
            <p className="mt-0.5 text-xs text-slate-500">{order.carrierName}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className={seloTom(STATUS_TOM[order.status])}>
            {STATUS_LABEL[order.status]}
          </span>
          {delayed && (
            <span className={seloTom(TOM_ATRASADO)}>
              Entrega em atraso
            </span>
          )}
          {order.hasOccurrence && (
            <span className={seloTom(TOM_OCORRENCIA)}>
              ⚠️ Intercorrencia
            </span>
          )}
        </div>
      </div>

      {/* Datas e valor */}
      <div className="grid grid-cols-2 gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm">
        <div>
          <p className="mb-0.5 text-xs text-slate-500">Emissao da NF</p>
          <p className="font-medium text-slate-800">{formatDate(order.nfIssuedAt)}</p>
        </div>
        <div>
          <p className="mb-0.5 text-xs text-slate-500">Valor da NF</p>
          <p className="font-medium text-slate-800">{formatCurrency(order.nfValue)}</p>
        </div>
        {order.shippedAt && (
          <div>
            <p className="mb-0.5 text-xs text-slate-500">Data de Envio</p>
            <p className="font-medium text-slate-800">{formatDate(order.shippedAt)}</p>
          </div>
        )}
        <div>
          <p className="mb-0.5 text-xs text-slate-500">
            {order.status === 'DELIVERED' ? 'Entregue em' : 'Previsao de Entrega'}
          </p>
          <p className={`font-medium ${delayed ? TOM[TOM_ATRASADO].texto : 'text-slate-800'}`}>
            {order.status === 'DELIVERED'
              ? formatDate(order.deliveredAt)
              : formatDate(order.estimatedDelivery)}
            {delayed && (() => {
              const today = new Date(); today.setHours(0, 0, 0, 0)
              const dias = Math.floor((today.getTime() - new Date(order.estimatedDelivery!).setHours(0, 0, 0, 0)) / 86400000)
              return <span className={`ml-1.5 ${seloTom(TOM_ATRASADO)}`}>{dias}d</span>
            })()}
          </p>
        </div>
      </div>

      {/* Rastreamento */}
      {events.length > 0 ? (
        <div className="px-5 py-4">
          <p className="resumo-rotulo mb-3">Rastreamento</p>
          <div className="max-h-56 overflow-y-auto pl-2 pt-1">
            <ol className="linha-tempo">
              {events.map((ev, i) => {
                const isFirst = i === 0
                const occ = isOccurrence(ev.description)
                const delivered = isDeliveredEvent(ev.description)
                const ponto = occ ? TOM[TOM_ATRASADO].ponto : delivered ? TOM.verde.ponto : isFirst ? 'linha-tempo-ponto-atual' : ''
                return (
                  <li key={i} className={`linha-tempo-item ${isFirst ? '' : 'opacity-75'}`}>
                    <span className={`linha-tempo-ponto ${ponto}`} />
                    <p className={`linha-tempo-texto font-medium ${occ ? TOM[TOM_ATRASADO].texto : delivered ? TOM.verde.texto : ''}`}>
                      {formatTrackingText(ev.description)}
                    </p>
                    {ev.date && <p className="linha-tempo-data">{formatDateTime(ev.date)}</p>}
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      ) : order.lastTracking ? (
        <div className={`mx-5 my-4 ${isOccurrence(order.lastTracking) ? 'alerta border-orange-200 bg-orange-50' : 'alerta-info'}`}>
          <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${isOccurrence(order.lastTracking) ? 'text-orange-700' : 'text-primaria-700'}`}>
            {isOccurrence(order.lastTracking) ? '⚠️ Intercorrencia' : 'Ultimo Rastreio'}
          </p>
          <p className={`text-sm font-medium ${isOccurrence(order.lastTracking) ? 'text-orange-800' : 'text-primaria-800'}`}>
            {formatTrackingText(order.lastTracking)}
          </p>
          {order.lastTrackingAt && (
            <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(order.lastTrackingAt)}</p>
          )}
        </div>
      ) : (
        <div className="px-5 py-4 text-sm italic text-slate-500">
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
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-white/10 bg-secundaria-escura text-white">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-white">Rastreamento de Pedidos</h1>
          <p className="mt-1 text-sm text-slate-300">
            Digite seu CNPJ ou CPF para visualizar suas entregas
          </p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8">
        <form onSubmit={handleSearch} className="mb-8 flex flex-col gap-3 sm:flex-row">
          <input
            type="text"
            value={doc}
            onChange={e => setDoc(maskDocument(e.target.value))}
            placeholder="000.000.000-00 ou 00.000.000/0000-00"
            className="input flex-1 py-3"
          />
          <button
            type="submit"
            disabled={loading}
            className="btn-primary px-6 py-3"
          >
            {loading ? 'Buscando...' : 'Buscar'}
          </button>
        </form>

        {error && (
          <div className="alerta-erro mb-6">
            {error}
          </div>
        )}

        {orders !== null && (
          <>
            {orders.length === 0 ? (
              <div className="estado-vazio">
                <p className="text-lg font-medium text-slate-700">Nenhum pedido encontrado</p>
                <p className="text-sm">Verifique se o documento informado esta correto.</p>
              </div>
            ) : (
              <>
                <p className="mb-4 text-sm text-slate-500">
                  {orders.length} {orders.length === 1 ? 'pedido encontrado' : 'pedidos encontrados'}
                  {' · '}
                  <span className="text-slate-400">Atualizado a cada 2 horas</span>
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
          <p className="mt-8 text-center text-sm text-slate-500">
            As informacoes sao atualizadas automaticamente a cada 2 horas.
          </p>
        )}
      </div>
    </div>
  )
}
