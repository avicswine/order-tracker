import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useEventos } from '../../lib/useEventos'
import { hora } from '../../components/TarefaCard'
import type { Empresa, TarefaResumo } from '../../types'

const DIAS_TRIAGEM = 3

function fmtValor(v: number | null) {
  return v === null ? '' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Jeovan marca aqui quais NFs vão para a separação por bipe.
export default function TriagemPage() {
  const [tarefas, setTarefas] = useState<TarefaResumo[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [empresa, setEmpresa] = useState('')
  const [busca, setBusca] = useState('')
  const [mostrarIgnoradas, setMostrarIgnoradas] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [sincronizando, setSincronizando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      setTarefas(await api.get<TarefaResumo[]>(`/tarefas?status=AGUARDANDO_TRIAGEM,PENDENTE,IGNORADA&dias=${DIAS_TRIAGEM}`))
      setErro('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar')
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { api.get<Empresa[]>('/empresas').then(setEmpresas).catch(() => undefined) }, [])
  useEventos(e => { if (e.tipo === 'tarefas') carregar() })

  async function sincronizar() {
    setSincronizando(true); setMsg(''); setErro('')
    try {
      const r = await api.post<{ novas: number; canceladas: number; erros: string[] }>('/tarefas/sync')
      setMsg(`Busca concluída: ${r.novas} NF(s) nova(s), ${r.canceladas} cancelada(s).`)
      if (r.erros.length) setErro(r.erros.join(' | '))
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao buscar NFs')
    } finally {
      setSincronizando(false)
    }
  }

  async function triar(ids: string[], acao: 'separar' | 'ignorar' | 'voltar') {
    if (ids.length === 0) return
    setMsg(''); setErro('')
    try {
      const r = await api.post<{ alteradas: number }>('/tarefas/triagem', { ids, acao })
      setMsg(`${r.alteradas} NF(s) ${acao === 'separar' ? 'enviada(s) para separação' : acao === 'ignorar' ? 'ignorada(s)' : 'devolvida(s) para triagem'}.`)
      setSelecionadas(new Set())
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro na triagem')
    }
  }

  const filtro = (t: TarefaResumo) =>
    (!empresa || t.companyKey === empresa) &&
    (!busca || `${t.nfNumero} ${t.clienteNome} ${t.canal ?? ''}`.toLowerCase().includes(busca.toLowerCase()))

  const aguardando = useMemo(() => tarefas.filter(t => t.status === 'AGUARDANDO_TRIAGEM' && filtro(t)), [tarefas, empresa, busca])
  const pendentes = useMemo(() => tarefas.filter(t => t.status === 'PENDENTE' && filtro(t)), [tarefas, empresa, busca])
  const ignoradas = useMemo(() => tarefas.filter(t => t.status === 'IGNORADA' && filtro(t)), [tarefas, empresa, busca])

  const toggle = (id: string) => setSelecionadas(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const todasSelecionadas = aguardando.length > 0 && aguardando.every(t => selecionadas.has(t.id))

  const Linha = ({ t, acoes, selecionavel }: { t: TarefaResumo; acoes: React.ReactNode; selecionavel?: boolean }) => (
    <tr className={`border-b border-slate-100 ${selecionadas.has(t.id) ? 'bg-brand-50' : ''}`}>
      {selecionavel && (
        <td className="p-2 w-8"><input type="checkbox" checked={selecionadas.has(t.id)} onChange={() => toggle(t.id)} /></td>
      )}
      <td className="p-2 font-semibold whitespace-nowrap">{t.empresa?.code} {t.nfNumero}</td>
      <td className="p-2">{t.clienteNome}</td>
      <td className="p-2 text-slate-500">{t.canal ?? '—'}</td>
      <td className="p-2 text-slate-500 text-right whitespace-nowrap">{fmtValor(t.valorNota)}</td>
      <td className="p-2 text-slate-500 whitespace-nowrap">{hora(t.nfEmitidaEm)}</td>
      <td className="p-2 text-right whitespace-nowrap">{acoes}</td>
    </tr>
  )

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <input className="input !py-2 !text-base max-w-xs" placeholder="Buscar NF, cliente, canal…" value={busca} onChange={e => setBusca(e.target.value)} />
        <select className="input !py-2 !text-base max-w-[10rem]" value={empresa} onChange={e => setEmpresa(e.target.value)}>
          <option value="">Todas as empresas</option>
          {empresas.map(e => <option key={e.key} value={e.key}>{e.name}</option>)}
        </select>
        <div className="flex-1" />
        <button className="btn-secondary !py-2" onClick={sincronizar} disabled={sincronizando}>{sincronizando ? 'Buscando…' : '⟳ Buscar NFs agora'}</button>
      </div>

      {msg && <div className="rounded-xl bg-green-50 text-green-700 px-4 py-2 text-sm mb-3">{msg}</div>}
      {erro && <div className="rounded-xl bg-red-50 text-red-700 px-4 py-2 text-sm mb-3">{erro}</div>}

      {/* Aguardando triagem */}
      <div className="card overflow-hidden mb-4">
        <div className="flex items-center gap-3 p-3 border-b border-slate-200 bg-slate-50">
          <div className="font-semibold flex-1">Aguardando triagem <span className="text-slate-500 font-normal">({aguardando.length})</span></div>
          <button className="btn-primary !py-1.5 !px-3 text-sm" disabled={selecionadas.size === 0} onClick={() => triar([...selecionadas], 'separar')}>
            Enviar para separação ({selecionadas.size})
          </button>
          <button className="btn-secondary !py-1.5 !px-3 text-sm" disabled={selecionadas.size === 0} onClick={() => triar([...selecionadas], 'ignorar')}>
            Ignorar ({selecionadas.size})
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="p-2 w-8"><input type="checkbox" checked={todasSelecionadas} onChange={() => setSelecionadas(todasSelecionadas ? new Set() : new Set(aguardando.map(t => t.id)))} /></th>
                <th className="p-2 text-left">NF</th><th className="p-2 text-left">Cliente</th><th className="p-2 text-left">Canal</th>
                <th className="p-2 text-right">Valor</th><th className="p-2 text-left">Emitida</th><th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {aguardando.map(t => (
                <Linha key={t.id} t={t} selecionavel acoes={
                  <>
                    <button className="text-brand-700 font-medium mr-3" onClick={() => triar([t.id], 'separar')}>Separar</button>
                    <button className="text-slate-500" onClick={() => triar([t.id], 'ignorar')}>Ignorar</button>
                  </>
                } />
              ))}
              {aguardando.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">Nenhuma NF aguardando triagem.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Já liberadas (pendentes) */}
      <div className="card overflow-hidden mb-4">
        <div className="p-3 border-b border-slate-200 bg-slate-50 font-semibold">Liberadas, aguardando separador <span className="text-slate-500 font-normal">({pendentes.length})</span></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {pendentes.map(t => (
                <Linha key={t.id} t={t} acoes={<button className="text-slate-500" onClick={() => triar([t.id], 'voltar')}>Voltar p/ triagem</button>} />
              ))}
              {pendentes.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-500">—</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ignoradas */}
      <div className="card overflow-hidden">
        <button className="w-full text-left p-3 border-b border-slate-200 bg-slate-50 font-semibold" onClick={() => setMostrarIgnoradas(v => !v)}>
          {mostrarIgnoradas ? '▾' : '▸'} Ignoradas <span className="text-slate-500 font-normal">({ignoradas.length})</span>
        </button>
        {mostrarIgnoradas && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {ignoradas.map(t => (
                  <Linha key={t.id} t={t} acoes={<button className="text-brand-700 font-medium" onClick={() => triar([t.id], 'separar')}>Separar afinal</button>} />
                ))}
                {ignoradas.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-500">—</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
