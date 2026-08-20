import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useEventos } from '../../lib/useEventos'
import ModalEstrutura from '../../components/ModalEstrutura'
import type { Empresa, TarefaResumo } from '../../types'

function fmtValor(v: number | null) {
  return v === null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function hojeISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) // YYYY-MM-DD
}

function somarDiasISO(iso: string, dias: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function dataHora(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Jeovan marca aqui quais NFs vão para a separação por bipe.
export default function TriagemPage() {
  const navigate = useNavigate()
  const [tarefas, setTarefas] = useState<TarefaResumo[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [empresa, setEmpresa] = useState('')
  const [busca, setBusca] = useState('')
  const [mostrarIgnoradas, setMostrarIgnoradas] = useState(false)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [sincronizando, setSincronizando] = useState(false)
  // Calendário: começa sempre no dia de hoje
  const [dataInicial, setDataInicial] = useState(hojeISO())
  const [dataFinal, setDataFinal] = useState(hojeISO())
  const [nfBusca, setNfBusca] = useState('')
  const [empresaBusca, setEmpresaBusca] = useState('')
  const [estruturaDe, setEstruturaDe] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      setTarefas(await api.get<TarefaResumo[]>(`/tarefas?status=AGUARDANDO_TRIAGEM,PENDENTE,IGNORADA&dataInicial=${dataInicial}&dataFinal=${dataFinal}`))
      setErro('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar')
    }
  }, [dataInicial, dataFinal])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { api.get<Empresa[]>('/empresas').then(setEmpresas).catch(() => undefined) }, [])
  useEventos(e => { if (e.tipo === 'tarefas') carregar() })

  // Busca no Bling as NFs do período selecionado no calendário (máx. 31 dias por busca)
  async function sincronizar() {
    setSincronizando(true); setMsg(''); setErro('')
    try {
      const corpo = { dataInicial, dataFinal, empresa: empresa || undefined }
      const r = await api.post<{ novas: number; canceladas: number; erros: string[]; periodo: { dataInicial: string; dataFinal: string } }>('/tarefas/sync', corpo)
      setMsg(`Busca no Bling (${r.periodo.dataInicial} a ${r.periodo.dataFinal}): ${r.novas} NF(s) nova(s), ${r.canceladas} cancelada(s).`)
      if (r.erros.length) setErro(r.erros.join(' | '))
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao buscar NFs')
    } finally {
      setSincronizando(false)
    }
  }

  // Busca uma NF específica pelo número (qualquer data) e coloca na triagem
  async function importarPorNumero(e: FormEvent) {
    e.preventDefault()
    if (!empresaBusca || !nfBusca.trim()) return setErro('Escolha a empresa e informe o número da NF')
    setSincronizando(true); setMsg(''); setErro('')
    try {
      const r = await api.post<{ novas: number; tarefas: TarefaResumo[] }>('/tarefas/importar', { empresa: empresaBusca, numero: nfBusca.trim() })
      const t = r.tarefas[0]
      setMsg(`NF ${t?.nfNumero ?? nfBusca} encontrada${r.novas ? ' e adicionada à triagem' : ` (já estava na fila — status: ${t?.status})`}.`)
      setNfBusca('')
      if (t?.nfEmitidaEm) {
        // ajusta o calendário para o dia da NF, senão ela não apareceria na lista
        const d = new Date(t.nfEmitidaEm).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
        setDataInicial(d); setDataFinal(d > hojeISO() ? d : hojeISO())
      } else {
        await carregar()
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao buscar NF')
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
      <td className="p-2 text-slate-700 text-right whitespace-nowrap">{fmtValor(t.valorNota)}</td>
      <td className="p-2 text-slate-500 whitespace-nowrap">{dataHora(t.nfEmitidaEm)}</td>
      <td className="p-2 text-slate-500 whitespace-nowrap text-center">
        {t.itensCarregados ? `${t.progresso.total} item(ns)` : <span className="text-slate-300">—</span>}
      </td>
      <td className="p-2 text-right whitespace-nowrap">
        <button onClick={() => setEstruturaDe(t.id)} className="text-slate-500 hover:text-brand-700 mr-3" title="Ver itens da NF (kits explodidos)">📋 Itens</button>
        <Link to={`/etiquetas?nf=${t.id}&papel=zebra`} className="text-slate-500 hover:text-brand-700 mr-3" title="Imprimir etiquetas Zebra desta NF">🏷 Etiquetas</Link>
        {acoes}
      </td>
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
        <button className="btn-secondary !py-2" onClick={sincronizar} disabled={sincronizando}>
          {sincronizando ? 'Buscando…' : dataInicial === dataFinal && dataInicial === hojeISO() ? '⟳ Buscar NFs de hoje' : '⟳ Buscar período no Bling'}
        </button>
      </div>

      {/* Calendário (padrão: hoje) e busca por número */}
      <div className="card p-3 mb-3 flex flex-wrap items-end gap-3 text-sm">
        <label>De<input type="date" className="input !py-1.5 !text-base ml-2 w-40" value={dataInicial} max={dataFinal} onChange={e => setDataInicial(e.target.value)} /></label>
        <label>Até<input type="date" className="input !py-1.5 !text-base ml-2 w-40" value={dataFinal} min={dataInicial} max={hojeISO()} onChange={e => setDataFinal(e.target.value)} /></label>
        <div className="flex gap-1">
          <button className="btn-secondary !py-1.5 !px-3 text-xs" onClick={() => { setDataInicial(hojeISO()); setDataFinal(hojeISO()) }}>Hoje</button>
          <button className="btn-secondary !py-1.5 !px-3 text-xs" onClick={() => { const o = somarDiasISO(hojeISO(), -1); setDataInicial(o); setDataFinal(o) }}>Ontem</button>
          <button className="btn-secondary !py-1.5 !px-3 text-xs" onClick={() => { setDataInicial(somarDiasISO(hojeISO(), -6)); setDataFinal(hojeISO()) }}>7 dias</button>
        </div>
        <form onSubmit={importarPorNumero} className="flex items-center gap-2 ml-auto">
          <select className="input !py-1.5 !text-base w-28" value={empresaBusca} onChange={e => setEmpresaBusca(e.target.value)}>
            <option value="">Empresa…</option>
            {empresas.map(e => <option key={e.key} value={e.key}>{e.code}</option>)}
          </select>
          <input className="input !py-1.5 !text-base w-32" placeholder="Nº da NF" inputMode="numeric" value={nfBusca} onChange={e => setNfBusca(e.target.value)} />
          <button className="btn-secondary !py-1.5" disabled={sincronizando}>Buscar NF no Bling</button>
        </form>
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
          <button
            className="btn-secondary !py-1.5 !px-3 text-sm"
            disabled={selecionadas.size === 0}
            title="Imprime as etiquetas de todos os SKUs dessas NFs que ainda não têm etiqueta"
            onClick={() => navigate(`/etiquetas?nfs=${[...selecionadas].join(',')}&papel=zebra`)}
          >
            🏷 Imprimir etiquetas ({selecionadas.size})
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
                <th className="p-2 text-right">Valor</th><th className="p-2 text-left">Emitida</th><th className="p-2 text-center">Itens</th><th className="p-2"></th>
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
              {aguardando.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-slate-500">Nenhuma NF aguardando triagem.</td></tr>}
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
              {pendentes.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-500">—</td></tr>}
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
                {ignoradas.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-slate-500">—</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {estruturaDe && <ModalEstrutura tarefaId={estruturaDe} onFechar={() => setEstruturaDe(null)} />}
    </div>
  )
}
