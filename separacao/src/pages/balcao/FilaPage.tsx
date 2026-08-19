import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TarefaCard from '../../components/TarefaCard'
import { api } from '../../lib/api'
import { useEventos } from '../../lib/useEventos'
import type { StatusTarefa, TarefaResumo } from '../../types'

const COLUNAS: { status: StatusTarefa; titulo: string; cor: string }[] = [
  { status: 'PENDENTE', titulo: 'Liberadas', cor: 'bg-amber-50' },
  { status: 'EM_SEPARACAO', titulo: 'Em separação', cor: 'bg-blue-50' },
  { status: 'SEPARADO', titulo: 'Separadas — aguardando balcão', cor: 'bg-green-50' },
  { status: 'CONCLUIDO', titulo: 'Concluídas', cor: 'bg-emerald-50' },
]

// Painel do dia em tempo real (SSE): o que está liberado, quem está separando, o que chegou ao balcão.
export default function FilaPage() {
  const navigate = useNavigate()
  const [tarefas, setTarefas] = useState<TarefaResumo[]>([])
  const [dias, setDias] = useState(1)

  const carregar = useCallback(async () => {
    try {
      setTarefas(await api.get<TarefaResumo[]>(`/tarefas?status=PENDENTE,EM_SEPARACAO,SEPARADO,CONCLUIDO&dias=${dias}`))
    } catch { /* mantém o que tinha */ }
  }, [dias])

  useEffect(() => { carregar() }, [carregar])
  useEventos(e => { if (e.tipo === 'tarefas' || e.tipo === 'tarefa') carregar() })

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 text-sm">
        <span className="text-slate-500">Período:</span>
        {[1, 2, 7].map(d => (
          <button key={d} className={`px-3 py-1 rounded-full border ${dias === d ? 'bg-brand-600 text-white border-brand-600' : 'bg-white'}`} onClick={() => setDias(d)}>
            {d === 1 ? 'Hoje' : `${d} dias`}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {COLUNAS.map(col => {
          const lista = tarefas.filter(t => t.status === col.status)
          return (
            <div key={col.status} className={`rounded-2xl p-2 ${col.cor} min-h-[12rem]`}>
              <div className="font-semibold text-sm px-1 mb-2">{col.titulo} <span className="text-slate-500 font-normal">({lista.length})</span></div>
              <div className="space-y-2">
                {lista.map(t => (
                  <TarefaCard key={t.id} tarefa={t} onClick={() => navigate(`/balcao/conferir/${t.id}`)} />
                ))}
                {lista.length === 0 && <div className="text-xs text-slate-400 px-1">—</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
