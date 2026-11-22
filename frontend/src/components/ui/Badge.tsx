import { STATUS_LABELS, STATUS_TOM, TOM_OCORRENCIA, TOM_ENTREGUE_COM_OCORRENCIA } from '../../lib/utils'
import { TOM, seloTom } from '../../lib/estilo'
import type { OrderStatus } from '../../types'

interface BadgeProps {
  status: OrderStatus
  hasOccurrence?: boolean
  lastTracking?: string | null
}

// Classifica o tipo de ocorrência pelo texto do rastreio (label específico no badge)
function occurrenceLabel(text?: string | null): string {
  const t = (text ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (t.includes('EXTRAVIO')) return 'Extravio Volume'
  if (t.includes('AVARIA')) return 'Avaria'
  if (t.includes('ROUBO') || t.includes('FURTO')) return 'Roubo/Furto'
  if (t.includes('DEVOLV') || t.includes('DEVOLUC')) return 'Devolução'
  if (t.includes('RECUSAD')) return 'Recusado'
  if (t.includes('AUSENTE')) return 'Destinatário Ausente'
  if (t.includes('ENDERECO')) return 'Endereço'
  return 'Ocorrência'
}

export function StatusBadge({ status, hasOccurrence, lastTracking }: BadgeProps) {
  // Entregue, mas teve ocorrência no caminho → "Entregue" em âmbar (resolvido com problema)
  if (status === 'DELIVERED' && hasOccurrence) {
    return (
      <span className={seloTom(TOM_ENTREGUE_COM_OCORRENCIA)} title="Entregue após ocorrência no transporte">
        <span className={`selo-ponto ${TOM[TOM_ENTREGUE_COM_OCORRENCIA].ponto}`} />
        Entregue (c/ ocorrência)
      </span>
    )
  }

  // Ocorrência ativa (não entregue) → vermelho com o tipo
  if (hasOccurrence) {
    return (
      <span className={seloTom(TOM_OCORRENCIA)}>
        <span className={`selo-ponto ${TOM[TOM_OCORRENCIA].ponto}`} />
        {occurrenceLabel(lastTracking)}
      </span>
    )
  }

  return (
    <span className={seloTom(STATUS_TOM[status])}>
      <span className={`selo-ponto ${TOM[STATUS_TOM[status]].ponto}`} />
      {STATUS_LABELS[status]}
    </span>
  )
}
