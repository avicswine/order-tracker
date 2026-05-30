import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

interface Notification {
  id: string
  channel: 'WHATSAPP' | 'EMAIL'
  recipient: string | null
  eventText: string | null
  sentAt: string
  success: boolean
  error: string | null
  order: {
    orderNumber: string
    customerName: string
    nfNumber: string | null
    senderCnpj: string | null
  }
}

interface NotificationsResponse {
  data: Notification[]
  meta: { total: number; page: number; limit: number; totalPages: number }
}

const COMPANY_BY_CNPJ: Record<string, string> = {
  '47.715.256/0001-49': 'AVIC',
  '54.695.386/0001-22': 'AGRO',
  '56.633.474/0001-25': 'EQUI',
}

const CHANNEL_STYLE = {
  WHATSAPP: { bg: 'bg-green-100 text-green-700', icon: '💬' },
  EMAIL:    { bg: 'bg-blue-100 text-blue-700',   icon: '✉️' },
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

function formatPhone(r: string | null) {
  if (!r) return '—'
  if (r.includes('@')) return r
  const n = r.replace(/\D/g, '')
  if (n.length === 13) return `+${n.slice(0,2)} (${n.slice(2,4)}) ${n.slice(4,9)}-${n.slice(9)}`
  return r
}

export function LogsPage() {
  const [page, setPage] = useState(1)
  const [channel, setChannel] = useState('')
  const [success, setSuccess] = useState('')
  const [search, setSearch] = useState('')

  const params = new URLSearchParams({ page: String(page), limit: '50' })
  if (channel) params.set('channel', channel)
  if (success !== '') params.set('success', success)
  if (search) params.set('orderNumber', search)

  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: ['notifications', page, channel, success, search],
    queryFn: () => api.get(`/notifications?${params}`).then((r: { data: NotificationsResponse }) => r.data),
  })

  const total = data?.meta.total ?? 0
  const totalPages = data?.meta.totalPages ?? 1

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Logs de Notificações</h1>
        <p className="text-sm text-gray-500 mt-0.5">Histórico de mensagens enviadas aos clientes</p>
      </div>

      {/* Filtros */}
      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Canal</label>
          <select className="input w-40" value={channel} onChange={e => { setChannel(e.target.value); setPage(1) }}>
            <option value="">Todos</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">Email</option>
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input w-36" value={success} onChange={e => { setSuccess(e.target.value); setPage(1) }}>
            <option value="">Todos</option>
            <option value="true">Enviado</option>
            <option value="false">Falhou</option>
          </select>
        </div>
        <div>
          <label className="label">Pedido / NF</label>
          <input
            className="input w-44"
            placeholder="Ex: 010595"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>
        {(channel || success || search) && (
          <button className="btn-secondary" onClick={() => { setChannel(''); setSuccess(''); setSearch(''); setPage(1) }}>
            Limpar
          </button>
        )}
        <span className="text-sm text-gray-500 ml-auto self-end">
          {total} registro{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Data/Hora</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Pedido</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Cliente</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Canal</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Destinatário</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Evento</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Carregando...</td></tr>
            ) : data?.data.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Nenhum registro encontrado</td></tr>
            ) : data?.data.map(n => {
              const ch = CHANNEL_STYLE[n.channel]
              const company = n.order.senderCnpj ? COMPANY_BY_CNPJ[n.order.senderCnpj] ?? '' : ''
              return (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDateTime(n.sentAt)}</td>
                  <td className="px-4 py-3">
                    <div className="font-mono font-medium text-gray-800">{n.order.nfNumber ? String(parseInt(n.order.nfNumber, 10)) : n.order.orderNumber}</div>
                    {company && <div className="text-xs text-gray-400">{company}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-700 max-w-[180px] truncate">{n.order.customerName}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ch.bg}`}>
                      {ch.icon} {n.channel}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs whitespace-nowrap">
                    {formatPhone(n.recipient)}
                  </td>
                  <td className="px-4 py-3 max-w-xs">
                    <p className="text-gray-600 text-xs truncate" title={n.eventText ?? ''}>{n.eventText ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3">
                    {n.success ? (
                      <span className="text-xs font-medium text-green-600">✅ Enviado</span>
                    ) : (
                      <span className="text-xs font-medium text-red-500" title={n.error ?? ''}>❌ Falhou</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button className="btn-secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹ Anterior</button>
          <span className="text-sm text-gray-500 self-center">Página {page} de {totalPages}</span>
          <button className="btn-secondary" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Próxima ›</button>
        </div>
      )}
    </div>
  )
}
