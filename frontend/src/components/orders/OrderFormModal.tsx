import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ordersApi, carriersApi } from '../../lib/api'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { SENDER_COMPANIES } from '../../lib/utils'
import type { Order } from '../../types'

interface FormData {
  orderNumber: string
  customerName: string
  customerEmail: string
  carrierId: string
  shippedAt: string
  estimatedDelivery: string
  notes: string
  nfNumber: string
  senderCnpj: string
}

interface Props {
  open: boolean
  onClose: () => void
  order?: Order | null
}

export function OrderFormModal({ open, onClose, order }: Props) {
  const qc = useQueryClient()
  const isEdit = !!order

  const { data: carriers } = useQuery({
    queryKey: ['carriers'],
    queryFn: carriersApi.list,
    enabled: open,
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormData>()

  useEffect(() => {
    if (open) {
      reset({
        orderNumber: order?.orderNumber ?? '',
        customerName: order?.customerName ?? '',
        customerEmail: order?.customerEmail ?? '',
        carrierId: order?.carrierId ?? '',
        shippedAt: order?.shippedAt ? order.shippedAt.slice(0, 10) : '',
        estimatedDelivery: order?.estimatedDelivery ? order.estimatedDelivery.slice(0, 10) : '',
        notes: order?.notes ?? '',
        nfNumber: order?.nfNumber ?? '',
        senderCnpj: order?.senderCnpj ?? '',
      })
    }
  }, [open, order, reset])

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      isEdit ? ordersApi.update(order!.id, data) : ordersApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      onClose()
    },
  })

  const onSubmit = (data: FormData) => mutation.mutate(data)

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Editar Pedido' : 'Novo Pedido'} size="lg">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Nº do Pedido *</label>
            <input
              className={`input ${errors.orderNumber ? 'border-red-400' : ''}`}
              placeholder="PED-0001"
              {...register('orderNumber', { required: 'Obrigatório' })}
              disabled={isEdit}
            />
            {errors.orderNumber && <p className="mt-1 text-xs text-red-500">{errors.orderNumber.message}</p>}
          </div>

          <div>
            <label className="label">Transportadora *</label>
            <select
              className={`input ${errors.carrierId ? 'border-red-400' : ''}`}
              {...register('carrierId', { required: 'Obrigatório' })}
            >
              <option value="">Selecionar...</option>
              {carriers?.filter((c) => c.active).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {errors.carrierId && <p className="mt-1 text-xs text-red-500">{errors.carrierId.message}</p>}
          </div>

          <div>
            <label className="label">Nome do Cliente *</label>
            <input
              className={`input ${errors.customerName ? 'border-red-400' : ''}`}
              placeholder="Nome completo"
              {...register('customerName', { required: 'Obrigatório' })}
            />
            {errors.customerName && <p className="mt-1 text-xs text-red-500">{errors.customerName.message}</p>}
          </div>

          <div>
            <label className="label">E-mail do Cliente</label>
            <input
              type="email"
              className={`input ${errors.customerEmail ? 'border-red-400' : ''}`}
              placeholder="cliente@email.com"
              {...register('customerEmail', {
                validate: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'E-mail inválido',
              })}
            />
            {errors.customerEmail && <p className="mt-1 text-xs text-red-500">{errors.customerEmail.message}</p>}
          </div>

          <div>
            <label className="label">Data de Envio</label>
            <input type="date" className="input" {...register('shippedAt')} />
          </div>

          <div>
            <label className="label">Previsão de Entrega</label>
            <input type="date" className="input" {...register('estimatedDelivery')} />
          </div>

          <div>
            <label className="label">Nº da NF</label>
            <input
              className="input"
              placeholder="000000"
              {...register('nfNumber')}
            />
          </div>

          <div>
            <label className="label">Empresa (Remetente)</label>
            <select className="input" {...register('senderCnpj')}>
              <option value="">Selecionar...</option>
              {SENDER_COMPANIES.map((c) => (
                <option key={c.cnpj} value={c.cnpj}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Observações</label>
          <textarea
            className="input resize-none"
            rows={2}
            placeholder="Informações adicionais..."
            {...register('notes')}
          />
        </div>

        {mutation.isError && (
          <p className="text-sm text-red-600">
            Erro ao salvar pedido. Verifique os dados e tente novamente.
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner className="h-4 w-4" /> : isEdit ? 'Salvar' : 'Criar Pedido'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
