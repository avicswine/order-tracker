import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BadgeStatus, hora } from '../../components/TarefaCard'
import { api } from '../../lib/api'
import { useEventos } from '../../lib/useEventos'
import { useBalanca } from '../../lib/balanca'
import { destravarAudio, feedbackConcluido, feedbackErro, feedbackOk } from '../../lib/feedback'
import type { Config, Item, Tarefa, TarefaResumo } from '../../types'

const TIPO_LABEL: Record<string, string> = {
  TRIAGEM: 'Triagem', INICIO: 'Início da separação', BIPE_OK: 'Bipe correto', BIPE_ERRADO: 'Bipe ERRADO',
  BIPE_EXCEDENTE: 'Bipe a mais', QTD_MANUAL: 'Quantidade digitada', PESO_OK: 'Peso OK', PESO_FORA: 'Peso FORA',
  LIBERACAO: 'Liberação de supervisor', SEPARADO: 'Separação concluída', FINALIZADO: 'Finalizada no balcão',
  CANCELADO: 'Cancelada', REABERTO: 'Reaberta / zerada',
}

function fmtQtd(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}

// Conferência no balcão: bipa a DANFE (ou nº da NF), vê como foi a separação, confere peso (se balança ativa) e finaliza.
export default function ConferirPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const [tarefa, setTarefa] = useState<Tarefa | null>(null)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [msg, setMsg] = useState('')
  const [pesoManual, setPesoManual] = useState<Record<string, string>>({})
  const balanca = useBalanca()

  const carregar = useCallback(async () => {
    if (!id) { setTarefa(null); return }
    try {
      setTarefa(await api.get<Tarefa>(`/tarefas/${id}`))
      setErro('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar')
    }
  }, [id])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { api.get<Config>('/config').then(setCfg).catch(() => undefined) }, [])
  useEventos(e => { if (e.tipo === 'tarefa' && e.tarefaId === id) carregar() })

  async function localizar(e: FormEvent) {
    e.preventDefault()
    const c = codigo.trim()
    if (!c) return
    destravarAudio()
    setErro(''); setMsg('')
    try {
      const r = await api.get<{ tarefas: TarefaResumo[] }>(`/tarefas/localizar?codigo=${encodeURIComponent(c)}`)
      setCodigo('')
      if (r.tarefas.length === 0) { feedbackErro(); return setErro('NF não encontrada na separação.') }
      // Prefere a que está SEPARADA/EM_SEPARACAO; senão a mais recente
      const alvo = r.tarefas.find(t => t.status === 'SEPARADO') ?? r.tarefas.find(t => t.status === 'EM_SEPARACAO') ?? r.tarefas[0]
      navigate(`/balcao/conferir/${alvo.id}`)
    } catch (err) {
      feedbackErro()
      setErro(err instanceof Error ? err.message : 'Erro ao localizar')
    }
  }

  async function finalizar(liberar = false) {
    if (!tarefa) return
    let motivo: string | undefined
    if (liberar) {
      const m = window.prompt('Motivo da liberação sem conferência de peso:')
      if (m === null) return
      motivo = m
    }
    setErro(''); setMsg('')
    try {
      const t = await api.post<Tarefa>(`/tarefas/${tarefa.id}/finalizar`, { liberar, motivo })
      setTarefa(t)
      feedbackConcluido()
      setMsg(`NF ${t.nfNumero} finalizada.`)
    } catch (e) {
      feedbackErro()
      setErro(e instanceof Error ? e.message : 'Erro ao finalizar')
    }
  }

  async function reabrir() {
    if (!tarefa) return
    const motivo = window.prompt('Motivo para reabrir a separação:')
    if (motivo === null) return
    try {
      setTarefa(await api.post<Tarefa>(`/tarefas/${tarefa.id}/reabrir`, { motivo }))
      setMsg('NF reaberta — volta para o separador.')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao reabrir')
    }
  }

  async function devolverTriagem() {
    if (!tarefa) return
    if (!window.confirm(`Devolver a NF ${tarefa.nfNumero} à triagem? A contagem feita até agora será descartada.`)) return
    try {
      await api.post('/tarefas/triagem', { ids: [tarefa.id], acao: 'voltar' })
      setMsg('NF devolvida à triagem.')
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao devolver')
    }
  }

  async function registrarPeso(item: Item, valor: number | null) {
    if (!tarefa || valor === null || !Number.isFinite(valor)) return setErro('Informe um peso válido')
    try {
      const r = await api.post<{ pesoOk: boolean | null; detalhe: string }>(`/tarefas/${tarefa.id}/itens/${item.id}/peso`, { peso: valor })
      if (r.pesoOk === true) feedbackOk(); else if (r.pesoOk === false) feedbackErro()
      setMsg(`${item.sku}: ${r.detalhe}`)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao registrar peso')
    }
  }

  const balancaAtiva = cfg?.balancaAtiva ?? false
  const itensPeso = tarefa?.itens.filter(i => i.qtdManual) ?? []
  const pesoPendente = balancaAtiva && itensPeso.some(i => i.pesoOk !== true)
  const bipesErrados = tarefa?.eventos.filter(e => e.tipo === 'BIPE_ERRADO' || e.tipo === 'BIPE_EXCEDENTE').length ?? 0

  return (
    <div>
      <form onSubmit={localizar} className="flex gap-2 mb-4 max-w-xl">
        <input className="input" placeholder="Bipe a DANFE ou digite o nº da NF" value={codigo} onChange={e => setCodigo(e.target.value)} autoFocus autoComplete="off" />
        <button className="btn-primary shrink-0">Abrir</button>
      </form>

      {msg && <div className="rounded-xl bg-green-50 text-green-700 px-4 py-2 text-sm mb-3">{msg}</div>}
      {erro && <div className="rounded-xl bg-red-50 text-red-700 px-4 py-2 text-sm mb-3">{erro}</div>}

      {!tarefa && !erro && <div className="card p-8 text-center text-slate-500">Bipe a DANFE de uma NF separada para conferir e finalizar.</div>}

      {tarefa && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Coluna principal: itens */}
          <div className="lg:col-span-2 space-y-4">
            <div className="card p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="text-2xl font-bold">NF {tarefa.nfNumero} <span className="text-base font-normal text-slate-500">{tarefa.empresa?.name}</span></div>
                  <div className="text-slate-700">{tarefa.clienteNome} {tarefa.canal && <span className="text-slate-400">· {tarefa.canal}</span>}</div>
                  <div className="text-sm text-slate-500 mt-1">
                    Separada por <b>{tarefa.operador?.nome ?? '—'}</b>
                    {tarefa.iniciadoEm && <> · início {hora(tarefa.iniciadoEm)}</>}
                    {tarefa.separadoEm && <> · fim {hora(tarefa.separadoEm)}</>}
                    {bipesErrados > 0 && <span className="ml-2 text-red-600 font-medium">· {bipesErrados} bipe(s) errado(s)</span>}
                  </div>
                </div>
                <BadgeStatus status={tarefa.status} />
              </div>

              <div className="flex gap-2 mt-4 flex-wrap">
                {tarefa.status === 'SEPARADO' && (
                  <>
                    <button className="btn-primary" onClick={() => finalizar(false)} disabled={pesoPendente}>✔ Finalizar NF</button>
                    {pesoPendente && <button className="btn-secondary" onClick={() => finalizar(true)}>Liberar sem peso (supervisor)</button>}
                    <button className="btn-secondary" onClick={reabrir}>Reabrir p/ separador</button>
                  </>
                )}
                {tarefa.status === 'CONCLUIDO' && <button className="btn-secondary" onClick={reabrir}>Reabrir</button>}
                <button className="btn-secondary" onClick={() => navigate(`/etiquetas?nf=${tarefa.id}`)} title="Imprimir QR dos SKUs desta NF que ainda não têm etiqueta">🏷 Etiquetas desta NF</button>
                {tarefa.status === 'EM_SEPARACAO' && (
                  <>
                    <div className="text-amber-700 bg-amber-50 rounded-xl px-3 py-2 text-sm">Ainda em separação — aguarde o separador concluir.</div>
                    <button className="btn-secondary" onClick={devolverTriagem}>Devolver à triagem</button>
                  </>
                )}
                {(tarefa.status === 'PENDENTE' || tarefa.status === 'AGUARDANDO_TRIAGEM') && <div className="text-slate-600 bg-slate-100 rounded-xl px-3 py-2 text-sm">Esta NF ainda não foi separada.</div>}
              </div>
              {pesoPendente && <div className="mt-2 text-sm text-amber-700">Há itens com quantidade digitada sem conferência de peso.</div>}
            </div>

            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 bg-slate-50">
                  <tr><th className="p-2 text-left">SKU</th><th className="p-2 text-left">Produto</th><th className="p-2 text-right">Qtd</th><th className="p-2 text-left">Como</th>{balancaAtiva && <th className="p-2 text-left">Peso</th>}</tr>
                </thead>
                <tbody>
                  {tarefa.itens.map(item => {
                    const esperado = item.pesoUnit ? item.pesoUnit * item.qtdEsperada : null
                    return (
                      <tr key={item.id} className={`border-t border-slate-100 ${item.concluidoEm ? '' : 'bg-red-50'}`}>
                        <td className="p-2 font-semibold whitespace-nowrap">{item.sku}</td>
                        <td className="p-2">{item.nome}{item.origemKit && <div className="text-xs text-slate-400">de: {item.origemKit}</div>}</td>
                        <td className="p-2 text-right whitespace-nowrap">{fmtQtd(item.qtdBipada)}/{fmtQtd(item.qtdEsperada)}</td>
                        <td className="p-2 whitespace-nowrap">
                          {!item.concluidoEm ? <span className="text-red-600 font-medium">pendente</span>
                            : item.qtdManual ? <span className="text-amber-700">qtd digitada</span>
                            : <span className="text-green-700">bipe unitário</span>}
                        </td>
                        {balancaAtiva && (
                          <td className="p-2">
                            {item.qtdManual ? (
                              <div className="flex items-center gap-1 flex-wrap">
                                <span className="text-xs text-slate-500">esp. {esperado ? esperado.toFixed(3) + ' kg' : 'sem peso cadastrado'}</span>
                                {item.pesoLido !== null && (
                                  <span className={`text-xs px-1.5 rounded ${item.pesoOk ? 'bg-green-100 text-green-800' : item.pesoOk === false ? 'bg-red-100 text-red-700' : 'bg-slate-100'}`}>
                                    lido {item.pesoLido.toFixed(3)} kg {item.pesoOk ? '✔' : item.pesoOk === false ? '✖' : ''}
                                  </span>
                                )}
                                {tarefa.status === 'SEPARADO' && (
                                  <>
                                    {balanca.conectada && <button className="btn-secondary !py-1 !px-2 text-xs" onClick={() => registrarPeso(item, balanca.pesoRecente)} disabled={balanca.pesoRecente === null}>Pesar ({balanca.pesoRecente?.toFixed(3) ?? '—'})</button>}
                                    <input className="input !py-1 !px-2 !text-sm w-20" placeholder="kg" value={pesoManual[item.id] ?? ''} onChange={e => setPesoManual(p => ({ ...p, [item.id]: e.target.value }))} />
                                    <button className="btn-secondary !py-1 !px-2 text-xs" onClick={() => registrarPeso(item, parseFloat((pesoManual[item.id] ?? '').replace(',', '.')))}>OK</button>
                                  </>
                                )}
                              </div>
                            ) : <span className="text-xs text-slate-400">—</span>}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Coluna lateral: balança + histórico */}
          <div className="space-y-4">
            {balancaAtiva && (
              <div className="card p-4">
                <div className="font-semibold mb-2">Balança</div>
                {!balanca.disponivel && <div className="text-sm text-amber-700">Web Serial indisponível — use Chrome/Edge no PC, ou digite o peso.</div>}
                {balanca.disponivel && !balanca.conectada && <button className="btn-secondary w-full" onClick={balanca.conectar}>Conectar balança (porta serial)</button>}
                {balanca.conectada && (
                  <div>
                    <div className="text-4xl font-bold text-center py-2">{balanca.pesoRecente !== null ? balanca.pesoRecente.toFixed(3) : '—'} <span className="text-base font-normal">kg</span></div>
                    <button className="btn-secondary w-full !py-1.5 text-sm" onClick={balanca.desconectar}>Desconectar</button>
                  </div>
                )}
                {balanca.erro && <div className="text-xs text-red-600 mt-2">{balanca.erro}</div>}
              </div>
            )}

            <div className="card p-4">
              <div className="font-semibold mb-2">Histórico</div>
              <div className="space-y-1 max-h-[28rem] overflow-y-auto text-sm">
                {tarefa.eventos.map(ev => (
                  <div key={ev.id} className={`flex gap-2 ${ev.tipo === 'BIPE_ERRADO' || ev.tipo === 'PESO_FORA' ? 'text-red-700' : ev.tipo === 'BIPE_EXCEDENTE' ? 'text-amber-700' : 'text-slate-700'}`}>
                    <span className="text-slate-400 whitespace-nowrap">{hora(ev.criadoEm)}</span>
                    <span className="flex-1">
                      {TIPO_LABEL[ev.tipo] ?? ev.tipo}
                      {ev.sku && <b> {ev.sku}</b>}
                      {ev.qtd !== null && ev.tipo !== 'BIPE_OK' && <> ({fmtQtd(ev.qtd)})</>}
                      {ev.detalhe && <span className="text-slate-500"> — {ev.detalhe}</span>}
                    </span>
                    <span className="text-slate-400 whitespace-nowrap">{ev.operador?.nome}</span>
                  </div>
                ))}
                {tarefa.eventos.length === 0 && <div className="text-slate-400">—</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
