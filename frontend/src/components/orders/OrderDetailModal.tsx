import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ordersApi } from '../../lib/api'
import { Modal } from '../ui/Modal'
import { StatusBadge } from '../ui/Badge'
import { Spinner } from '../ui/Spinner'
import { formatDate, formatDateTime, STATUS_LABELS, SENDER_COMPANIES } from '../../lib/utils'
import type { Order, OrderStatus } from '../../types'

const STATUS_ORDER: OrderStatus[] = ['PENDING', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']

interface Props {
  order: Order | null
  onClose: () => void
}

export function OrderDetailModal({ order, onClose }: Props) {
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

          <div className="grid grid-cols-2 gap-4 rounded-lg bg-gray-50 p-4">
            <div>
              <p className="text-xs text-gray-500">Cliente</p>
              <p className="font-medium">{data.customerName}</p>
              {data.customerEmail && <p className="text-sm text-gray-600">{data.customerEmail}</p>}
            </div>
            <div>
              <p className="text-xs text-gray-500">Transportadora</p>
              <p className="font-medium">{data.carrier.name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Data de Envio</p>
              <p className="font-medium">{formatDate(data.shippedAt)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Previsão de Entrega</p>
              <p className="font-medium">{formatDate(data.estimatedDelivery)}</p>
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
            {data.senderCnpj && (
              <div>
                <p className="text-xs text-gray-500">Empresa Remetente</p>
                <p className="font-medium">
                  {SENDER_COMPANIES.find((c) => c.cnpj === data.senderCnpj)?.name ?? data.senderCnpj}
                </p>
                <p className="text-xs text-gray-500">{data.senderCnpj}</p>
              </div>
            )}
            {data.notes && (
              <div className="col-span-2">
                <p className="text-xs text-gray-500">Observações</p>
                <p className="text-sm">{data.notes}</p>
              </div>
            )}
          </div>

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
          {data.status !== 'DELIVERED' && data.status !== 'CANCELLED' && (
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
