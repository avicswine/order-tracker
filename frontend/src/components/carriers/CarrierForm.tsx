import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { carriersApi } from '../../lib/api'
import { Modal } from '../ui/Modal'
import { Spinner } from '../ui/Spinner'
import { formatCNPJ, formatPhone } from '../../lib/utils'
import type { Carrier } from '../../types'

import type { TrackingSystem } from '../../types'

interface FormData {
  name: string
  cnpj: string
  phone: string
  active: boolean
  trackingSystem: TrackingSystem
  trackingIdentifier: string
}

interface Props {
  open: boolean
  onClose: () => void
  carrier?: Carrier | null
}

export function CarrierFormModal({ open, onClose, carrier }: Props) {
  const qc = useQueryClient()
  const isEdit = !!carrier

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<FormData>()

  useEffect(() => {
    if (open) {
      reset({
        name: carrier?.name ?? '',
        cnpj: carrier?.cnpj ?? '',
        phone: carrier?.phone ?? '',
        active: carrier?.active ?? true,
        trackingSystem: carrier?.trackingSystem ?? 'NONE',
        trackingIdentifier: carrier?.trackingIdentifier ?? '',
      })
    }
  }, [open, carrier, reset])

  const trackingSystem = watch('trackingSystem')

  const mutation = useMutation({
    mutationFn: (data: FormData) =>
      isEdit ? carriersApi.update(carrier!.id, data) : carriersApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['carriers'] })
      onClose()
    },
  })

  const cnpjValue = watch('cnpj')
  const phoneValue = watch('phone')

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Editar Transportadora' : 'Nova Transportadora'}>
      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <div>
          <label className="label">Nome *</label>
          <input
            className={`input ${errors.name ? 'border-red-400' : ''}`}
            placeholder="Razão social"
            {...register('name', { required: 'Obrigatório' })}
          />
          {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
        </div>

        <div>
          <label className="label">CNPJ *</label>
          <input
            className={`input ${errors.cnpj ? 'border-red-400' : ''}`}
            placeholder="00.000.000/0000-00"
            value={cnpjValue ?? ''}
            {...register('cnpj', {
              required: 'Obrigatório',
              pattern: {
                value: /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/,
                message: 'Formato: 00.000.000/0000-00',
              },
            })}
            onChange={(e) => setValue('cnpj', formatCNPJ(e.target.value))}
          />
          {errors.cnpj && <p className="mt-1 text-xs text-red-500">{errors.cnpj.message}</p>}
        </div>

        <div>
          <label className="label">Telefone *</label>
          <input
            className={`input ${errors.phone ? 'border-red-400' : ''}`}
            placeholder="(00) 00000-0000"
            value={phoneValue ?? ''}
            {...register('phone', { required: 'Obrigatório' })}
            onChange={(e) => setValue('phone', formatPhone(e.target.value))}
          />
          {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone.message}</p>}
        </div>

        {/* Sistema de rastreamento */}
        <div>
          <label className="label">Sistema de rastreamento</label>
          <select className="input" {...register('trackingSystem')}>
            <option value="NONE">Não configurado</option>
            <option value="SSW">SSW (ssw.inf.br)</option>
            <option value="SENIOR">Senior TCK</option>
            <option value="SAO_MIGUEL">Expresso São Miguel (API)</option>
            <option value="ATUAL_CARGAS">Atual Cargas (Portal)</option>
            <option value="RODONAVES">Rodonaves (API)</option>
            <option value="BRASPRESS">Braspress (API)</option>
            <option value="PUPPETEER">Portal Web (automação)</option>
          </select>
        </div>

        {trackingSystem === 'SSW' && (
          <div>
            <label className="label">Código da empresa no SSW (sigla_emp)</label>
            <input
              className="input"
              placeholder="Ex: BAU, MNG..."
              {...register('trackingIdentifier')}
            />
            <p className="mt-1 text-xs text-gray-400">Deixe em branco para buscar em toda a rede SSW</p>
          </div>
        )}

        {trackingSystem === 'SENIOR' && (
          <div>
            <label className="label">Tenant do Senior TCK</label>
            <input
              className="input"
              placeholder="Ex: trdtransportes"
              {...register('trackingIdentifier')}
            />
          </div>
        )}

        {trackingSystem === 'SAO_MIGUEL' && (
          <div>
            <label className="label">CNPJ usado na consulta</label>
            <select className="input" {...register('trackingIdentifier')}>
              <option value="remetente">Remetente (CNPJ da empresa)</option>
              <option value="destinatario">Destinatário (CNPJ do cliente)</option>
            </select>
          </div>
        )}

        {trackingSystem === 'BRASPRESS' && (
          <div>
            <label className="label">CNPJ usado na consulta</label>
            <select className="input" {...register('trackingIdentifier')}>
              <option value="remetente">Remetente (CNPJ da empresa)</option>
              <option value="destinatario">Destinatário (CNPJ do cliente)</option>
            </select>
          </div>
        )}

        {trackingSystem === 'PUPPETEER' && (
          <div>
            <label className="label">Portal da transportadora</label>
            <select className="input" {...register('trackingIdentifier')}>
              <option value="">Selecione o portal...</option>
              <option value="EXPRESSO_SAO_MIGUEL">Expresso São Miguel</option>
            </select>
          </div>
        )}

        {isEdit && (
          <div className="flex items-center gap-3">
            <input
              id="active"
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              {...register('active')}
            />
            <label htmlFor="active" className="text-sm font-medium text-gray-700">
              Transportadora ativa
            </label>
          </div>
        )}

        {mutation.isError && (
          <p className="text-sm text-red-600">
            Erro ao salvar. Verifique o CNPJ e tente novamente.
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? <Spinner className="h-4 w-4" /> : isEdit ? 'Salvar' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
