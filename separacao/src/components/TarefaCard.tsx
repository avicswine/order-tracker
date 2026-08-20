import type { TarefaResumo } from '../types'
import { STATUS_LABEL } from '../types'

const COR_STATUS: Record<string, string> = {
  AGUARDANDO_TRIAGEM: 'bg-slate-100 text-slate-700',
  PENDENTE: 'bg-amber-100 text-amber-800',
  EM_SEPARACAO: 'bg-blue-100 text-blue-800',
  SEPARADO: 'bg-green-100 text-green-800',
  CONCLUIDO: 'bg-emerald-600 text-white',
  IGNORADA: 'bg-slate-200 text-slate-500',
  CANCELADA: 'bg-red-100 text-red-700',
}

export function BadgeStatus({ status }: { status: TarefaResumo['status'] }) {
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${COR_STATUS[status] ?? ''}`}>{STATUS_LABEL[status]}</span>
}

export function hora(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function TarefaCard({ tarefa, onClick, destaque, acao, onExcluir }: {
  tarefa: TarefaResumo
  onClick?: () => void
  destaque?: boolean
  acao?: React.ReactNode
  onExcluir?: () => void   // lixeira no canto: desistir da separação desta NF
}) {
  const p = tarefa.progresso
  const pct = p.unidadesEsperadas > 0 ? Math.round((p.unidadesBipadas / p.unidadesEsperadas) * 100) : 0
  return (
    <div
      onClick={onClick}
      className={`card p-3 ${onClick ? 'cursor-pointer active:bg-slate-50' : ''} ${destaque ? 'border-brand-500 ring-2 ring-brand-100' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 order-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-lg">NF {tarefa.nfNumero}</span>
            <span className="text-xs bg-slate-800 text-white rounded px-1.5 py-0.5">{tarefa.empresa?.code ?? tarefa.companyKey}</span>
            <BadgeStatus status={tarefa.status} />
          </div>
          <div className="text-sm text-slate-700 truncate">{tarefa.clienteNome}</div>
          <div className="text-xs text-slate-500 flex gap-2 flex-wrap">
            {tarefa.canal && <span>{tarefa.canal}</span>}
            {tarefa.nfEmitidaEm && <span>emitida {hora(tarefa.nfEmitidaEm)}</span>}
            {tarefa.operador && <span>· {tarefa.operador.nome}</span>}
          </div>
        </div>
        {acao}
        {onExcluir && (
          <button
            className="order-2 shrink-0 -mt-1 -mr-1 p-2 text-slate-300 hover:text-red-600 active:text-red-700 text-lg leading-none"
            title="Cancelar a separação desta NF"
            aria-label="Cancelar separação"
            onClick={e => { e.stopPropagation(); onExcluir() }}
          >
            🗑
          </button>
        )}
      </div>
      {tarefa.itensCarregados && p.total > 0 && (
        <div className="mt-2">
          <div className="flex justify-between text-xs text-slate-500 mb-0.5">
            <span>{p.concluidos}/{p.total} itens</span>
            <span>{p.unidadesBipadas}/{p.unidadesEsperadas} un.</span>
          </div>
          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className={`h-full ${p.completo ? 'bg-green-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}
