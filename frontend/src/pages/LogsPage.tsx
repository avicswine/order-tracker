import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'
import { formatDateTime } from '../lib/utils'
import { seloTom, type Tom } from '../lib/estilo'

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
  WHATSAPP: { tom: 'verde' as Tom, icon: '💬' },
  EMAIL:    { tom: 'primaria' as Tom, icon: '✉️' },
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
    <div className="pagina">
      <div>
        <h1 className="pagina-titulo">Logs de Notificações</h1>
        <p className="pagina-subtitulo">Histórico de mensagens enviadas aos clientes</p>
      </div>

      {/* Filtros */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
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
        <span className="text-sm text-slate-500 ml-auto self-end">
          {total} registro{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        <div className="tabela-caixa">
        <table className="tabela">
          <thead>
            <tr>
              <th>Data/Hora</th>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Canal</th>
              <th>Destinatário</th>
              <th>Evento</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7}><div className="estado-carregando">Carregando...</div></td></tr>
            ) : data?.data.length === 0 ? (
              <tr><td colSpan={7}><div className="estado-vazio">Nenhum registro encontrado</div></td></tr>
            ) : data?.data.map(n => {
              const ch = CHANNEL_STYLE[n.channel]
              const company = n.order.senderCnpj ? COMPANY_BY_CNPJ[n.order.senderCnpj] ?? '' : ''
              return (
                <tr key={n.id}>
                  <td className="text-slate-500 whitespace-nowrap">{formatDateTime(n.sentAt)}</td>
                  <td>
                    <div className="font-mono font-medium text-slate-800">{n.order.nfNumber ? String(parseInt(n.order.nfNumber, 10)) : n.order.orderNumber}</div>
                    {company && <div className="text-xs text-slate-400">{company}</div>}
                  </td>
                  <td>
                    <div className="text-slate-700 max-w-[180px] truncate">{n.order.customerName}</div>
                  </td>
                  <td>
                    <span className={seloTom(ch.tom)}>
                      {ch.icon} {n.channel}
                    </span>
                  </td>
                  <td className="text-slate-600 font-mono text-xs whitespace-nowrap">
                    {formatPhone(n.recipient)}
                  </td>
                  <td className="max-w-xs">
                    <p className="text-slate-600 text-xs truncate" title={n.eventText ?? ''}>{n.eventText ?? '—'}</p>
                  </td>
                  <td>
                    {n.success ? (
                      <span className={seloTom('verde')}>Enviado</span>
                    ) : (
                      <span className={seloTom('vermelho')} title={n.error ?? ''}>Falhou</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn-secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹ Anterior</button>
          <span className="text-sm text-slate-500 self-center">Página {page} de {totalPages}</span>
          <button className="btn-secondary" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Próxima ›</button>
        </div>
      )}
    </div>
  )
}
