import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ordersApi } from '../../lib/api'
import { Modal } from '../ui/Modal'
import { StatusBadge } from '../ui/Badge'
import { Spinner } from '../ui/Spinner'
import { formatDate, formatDateTime, STATUS_LABELS, SENDER_COMPANIES, isOccurrenceEvent } from '../../lib/utils'
import { useAuth } from '../../contexts/AuthContext'
import type { Order, OrderStatus, TrackingEvent } from '../../types'

const STATUS_ORDER: OrderStatus[] = ['PENDING', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']

interface Props {
  order: Order | null
  onClose: () => void
}

export function OrderDetailModal({ order, onClose }: Props) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'ADMIN'
  const qc = useQueryClient()
  const [newStatus, setNewStatus] = useState<OrderStatus | ''>('')
  const [note, setNote] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['order', order?.id],
    queryFn: () => ordersApi.get(order!.id),
    enabled: !!order?.id,
  })

  const mutation = useMutation({
    mutationFn: ({ status, note }: { status: OrderStatus; note: string }) =>
      ordersApi.updateStatus(order!.id, status, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['order', order?.id] })
      setNewStatus('')
      setNote('')
    },
  })

  const handleStatusUpdate = () => {
    if (!newStatus) return
    mutation.mutate({ status: newStatus, note })
  }

  return (
    <Modal open={!!order} onClose={onClose} title="Detalhes do Pedido" size="xl">
      {isLoading && (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Nº do Pedido</p>
              <p className="font-mono text-lg font-bold text-gray-900">{data.orderNumber}</p>
            </div>
            <div className="text-right">
              <StatusBadge status={data.status} />
            </div>
          </div>

          {(() => {
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const isDelayed = !!(data.estimatedDelivery && data.status !== 'DELIVERED' && data.status !== 'CANCELLED' && new Date(data.estimatedDelivery) < today)
            return (
          <div className="grid grid-cols-2 gap-4 rounded-lg bg-gray-50 p-4">
            <div>
              <p className="text-xs text-gray-500">Cliente</p>
              <p className="font-medium">{data.customerName}</p>
              {data.customerEmail && <p className="text-sm text-gray-600">{data.customerEmail}</p>}
            </div>
            <div>
              <p className="text-xs text-gray-500">Transportadora</p>
              <p className={`font-medium ${!data.carrier ? 'text-amber-600' : ''}`}>
                {data.carrier?.name ?? 'A definir'}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Data de Envio</p>
              <p className="font-medium">{formatDate(data.shippedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Previsão de Entrega</p>
              <p className={`font-medium ${isDelayed ? 'text-orange-600' : ''}`}>
                {formatDate(data.estimatedDelivery)}
                {isDelayed && (
                  <span className="ml-2 text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">atrasado</span>
                )}
              </p>
            </div>
            {data.deliveredAt && (
              <div>
                <p className="text-xs text-gray-500">Entregue em</p>
                <p className="font-medium text-green-700">{formatDate(data.deliveredAt)}</p>
              </div>
            )}
            {data.nfNumber && (
              <div>
                <p className="text-xs text-gray-500">Nº da NF</p>
                <p className="font-medium font-mono">{data.nfNumber}</p>
              </div>
            )}
            {data.senderCnpj && (() => {
              const company = SENDER_COMPANIES.find((c) => c.cnpj === data.senderCnpj)
              return (
                <div>
                  <p className="text-xs text-gray-500">Empresa Remetente</p>
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${company?.color ?? 'bg-gray-100 text-gray-700'}`}>
                    {company?.name ?? data.senderCnpj}
                  </span>
                  <p className="text-xs text-gray-400 mt-0.5">{data.senderCnpj}</p>
                </div>
              )
            })()}
            {data.recipientCnpj && (
              <div>
                <p className="text-xs text-gray-500">CNPJ do Destinatário</p>
                <p className="font-medium font-mono">{data.recipientCnpj}</p>
              </div>
            )}
            {data.notes && (
              <div className="col-span-2">
                <p className="text-xs text-gray-500">Observações</p>
                <p className="text-sm">{data.notes}</p>
              </div>
            )}
          </div>
            )
          })()}

          {/* Rastreamento completo */}
          {data.trackingEvents && data.trackingEvents.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Rastreamento</h3>
              <div className="space-y-0 max-h-64 overflow-y-auto">
                {(data.trackingEvents as TrackingEvent[]).map((event, idx) => {
                  const isFirst = idx === 0
                  const isLast = idx === (data.trackingEvents as TrackingEvent[]).length - 1
                  const isOccurrence = isOccurrenceEvent(event.description)
                  const isDelivery = event.description.toUpperCase().includes('ENTREGUE') || event.description.toUpperCase().includes('ENTREGA REALIZADA') || event.description.toUpperCase().includes('ENTREGA EFETUADA')
                  const dotColor = isOccurrence ? 'bg-orange-400' : isDelivery ? 'bg-green-500' : isFirst ? 'bg-blue-500' : 'bg-gray-300'
                  return (
                    <div key={idx} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`h-2.5 w-2.5 rounded-full mt-1 flex-shrink-0 ${dotColor}`} />
                        {!isLast && <div className="w-px flex-1 bg-gray-200 mt-1 mb-0" />}
                      </div>
                      <div className={`pb-3 ${isFirst ? '' : 'opacity-75'}`}>
                        <p className={`text-sm font-medium ${isOccurrence ? 'text-orange-700' : isDelivery ? 'text-green-700' : 'text-gray-800'}`}>
                          {event.description}
                        </p>
                        {event.date && (
                          <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(event.date)}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : data.lastTracking ? (
            <div className={`rounded-lg p-3 ${isOccurrenceEvent(data.lastTracking) ? 'bg-orange-50 border border-orange-200' : 'bg-blue-50 border border-blue-100'}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${isOccurrenceEvent(data.lastTracking) ? 'text-orange-600' : 'text-blue-600'}`}>
                {isOccurrenceEvent(data.lastTracking) ? '⚠️ Intercorrência' : 'Último Rastreio'}
              </p>
              <p className={`text-sm font-medium ${isOccurrenceEvent(data.lastTracking) ? 'text-orange-800' : 'text-blue-800'}`}>
                {data.lastTracking}
              </p>
              {data.lastTrackingAt && (
                <p className="text-xs text-gray-500 mt-0.5">{formatDateTime(data.lastTrackingAt)}</p>
              )}
            </div>
          ) : null}

          {/* Status history */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Histórico de Status</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {data.statusHistory?.map((entry, idx) => (
                <div key={entry.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-2 w-2 rounded-full bg-blue-500 mt-1.5" />
                    {idx < (data.statusHistory?.length ?? 0) - 1 && (
                      <div className="w-px flex-1 bg-gray-200 mt-1" />
                    )}
                  </div>
                  <div className="pb-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={entry.status} />
                      <span className="text-xs text-gray-500">{formatDateTime(entry.createdAt)}</span>
                    </div>
                    {entry.note && <p className="text-xs text-gray-600 mt-0.5">{entry.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Update status */}
          {isAdmin && data.status !== 'DELIVERED' && data.status !== 'CANCELLED' && (
            <div className="rounded-lg border border-dashed border-gray-300 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">Atualizar Status</h3>
              <div className="flex gap-3">
                <select
                  className="input"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as OrderStatus)}
                >
                  <option value="">Selecionar novo status...</option>
                  {STATUS_ORDER.filter((s) => s !== data.status).map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
                <input
                  type="text"
                  className="input"
                  placeholder="Observação (opcional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button
                  className="btn-primary whitespace-nowrap"
                  disabled={!newStatus || mutation.isPending}
                  onClick={handleStatusUpdate}
                >
                  {mutation.isPending ? <Spinner className="h-4 w-4" /> : 'Salvar'}
                </button>
              </div>
              {mutation.isError && (
                <p className="text-xs text-red-600">Erro ao atualizar status. Tente novamente.</p>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
