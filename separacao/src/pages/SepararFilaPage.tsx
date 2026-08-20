import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import Shell from '../components/Shell'
import TarefaCard from '../components/TarefaCard'
import ScannerQr from '../components/ScannerQr'
import FotoDanfe from '../components/FotoDanfe'
import { api } from '../lib/api'
import { useEventos } from '../lib/useEventos'
import { useAuth } from '../contexts/AuthContext'
import { destravarAudio, feedbackErro } from '../lib/feedback'
import type { Empresa, TarefaResumo } from '../types'

// Fila do celular: NFs liberadas na triagem (PENDENTE) e as já em separação.
export default function SepararFilaPage() {
  const navigate = useNavigate()
  const { operador } = useAuth()
  const [tarefas, setTarefas] = useState<TarefaResumo[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresa, setEmpresa] = useState<string>('')
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [camera, setCamera] = useState(false)
  const [cancelar, setCancelar] = useState<TarefaResumo | null>(null)
  const [cancelando, setCancelando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const lista = await api.get<TarefaResumo[]>('/tarefas?status=PENDENTE,EM_SEPARACAO&dias=3')
      setTarefas(lista)
      setErro('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar fila')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { api.get<Empresa[]>('/empresas').then(setEmpresas).catch(() => undefined) }, [])
  useEventos(e => { if (e.tipo === 'tarefas') carregar() })

  async function abrir(t: TarefaResumo) {
    destravarAudio()
    try {
      await api.post(`/tarefas/${t.id}/iniciar`)
      navigate(`/separar/${t.id}`)
    } catch (e) {
      feedbackErro()
      setErro(e instanceof Error ? e.message : 'Não foi possível iniciar')
    }
  }

  // Lixeira: desiste da NF. remover = tira da separação e devolve à triagem (só supervisor)
  async function cancelarSeparacao(remover: boolean) {
    if (!cancelar) return
    setCancelando(true)
    try {
      await api.post(`/tarefas/${cancelar.id}/cancelar-separacao`, { remover })
      setCancelar(null)
      setErro('')
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao cancelar')
      setCancelar(null)
    } finally {
      setCancelando(false)
    }
  }

  // Bipar/digitar a NF (chave da DANFE ou número) — pelo campo (leitor Bluetooth/teclado) ou pela câmera
  async function localizar(e?: FormEvent, valorCamera?: string) {
    e?.preventDefault()
    const valor = (valorCamera ?? codigo).trim()
    if (!valor) return
    destravarAudio()
    try {
      const r = await api.get<{ tarefas: TarefaResumo[] }>(`/tarefas/localizar?codigo=${encodeURIComponent(valor)}${empresa ? `&empresa=${empresa}` : ''}`)
      setCodigo('')
      const validas = r.tarefas.filter(t => t.status === 'PENDENTE' || t.status === 'EM_SEPARACAO')
      if (validas.length === 1) return abrir(validas[0])
      if (r.tarefas.length === 0) { feedbackErro('Nota não encontrada'); return setErro('NF não encontrada. Ela já passou pela triagem?') }
      if (validas.length === 0) { feedbackErro(); return setErro(`NF encontrada, mas está "${r.tarefas[0].status}". Peça ao balcão para liberar.`) }
      setErro('Mais de uma NF com esse número — selecione a empresa e tente de novo.')
    } catch (err) {
      feedbackErro()
      setErro(err instanceof Error ? err.message : 'Erro ao localizar')
    }
  }

  const minhas = tarefas.filter(t => t.status === 'EM_SEPARACAO' && t.operador?.id === operador?.id)
  const filtradas = tarefas.filter(t => (!empresa || t.companyKey === empresa) && !minhas.includes(t))

  return (
    <Shell titulo="Separar" voltarPara="/">
      <form onSubmit={localizar} className="flex gap-2 mb-2">
        <input
          className="input"
          placeholder="Bipe a DANFE ou digite o nº da NF"
          value={codigo}
          onChange={e => setCodigo(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
        />
        <button type="button" className={`btn-secondary shrink-0 !px-3 ${camera ? '!bg-brand-50 !border-brand-500' : ''}`} onClick={() => { destravarAudio(); setCamera(c => !c) }} title="Ler código de barras da DANFE pela câmera">📷</button>
        <button className="btn-primary shrink-0">Abrir</button>
      </form>
      {camera && (
        <div className="mb-3">
          <ScannerQr ativo={camera} modoCodigoBarras onCodigo={v => localizar(undefined, v)} />
          <div className="mt-2">
            <FotoDanfe
              empresa={empresa || undefined}
              onEncontrou={tarefas => {
                const validas = tarefas.filter(t => t.status === 'PENDENTE' || t.status === 'EM_SEPARACAO')
                if (validas.length === 1) return abrir(validas[0])
                if (validas.length === 0) { feedbackErro(); setErro(`NF encontrada, mas está "${tarefas[0].status}". Peça ao balcão para liberar.`) }
                else setErro('Mais de uma NF com esse número — selecione a empresa e tente de novo.')
              }}
              onErro={m => { feedbackErro(); setErro(m) }}
            />
            <p className="text-xs text-slate-500 mt-1">Se o código de barras não ler, tire uma foto da etiqueta: o sistema lê o número da nota.</p>
          </div>
        </div>
      )}

      {empresas.length > 1 && (
        <div className="flex gap-2 mb-3 overflow-x-auto">
          <button className={`px-3 py-1 rounded-full text-sm border ${empresa === '' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white'}`} onClick={() => setEmpresa('')}>Todas</button>
          {empresas.map(e => (
            <button key={e.key} className={`px-3 py-1 rounded-full text-sm border ${empresa === e.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white'}`} onClick={() => setEmpresa(e.key)}>{e.code}</button>
          ))}
        </div>
      )}

      {erro && <div className="rounded-xl bg-red-50 text-red-700 px-4 py-2 text-sm mb-3">{erro}</div>}

      {minhas.length > 0 && (
        <>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Continuar</div>
          <div className="space-y-2 mb-4">
            {minhas.map(t => (
              <TarefaCard key={t.id} tarefa={t} destaque onClick={() => navigate(`/separar/${t.id}`)} onExcluir={() => setCancelar(t)} />
            ))}
          </div>
        </>
      )}

      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Fila ({filtradas.length})</div>
      {carregando && <div className="text-slate-500 text-sm">Carregando…</div>}
      {!carregando && filtradas.length === 0 && (
        <div className="card p-6 text-center text-slate-500">Nenhuma NF liberada para separação no momento.</div>
      )}
      <div className="space-y-2">
        {filtradas.map(t => (
          <TarefaCard
            key={t.id}
            tarefa={t}
            onClick={() => abrir(t)}
            onExcluir={t.status === 'EM_SEPARACAO' ? () => setCancelar(t) : undefined}
          />
        ))}
      </div>

      {/* Confirmação da lixeira */}
      {cancelar && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => setCancelar(null)}>
          <div className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="font-bold text-lg">Cancelar a separação da NF {cancelar.nfNumero}?</div>
            <p className="text-sm text-slate-600 mt-1">
              {cancelar.clienteNome}
              {cancelar.progresso.unidadesBipadas > 0 && (
                <span className="block mt-1 text-amber-700">
                  Atenção: {cancelar.progresso.unidadesBipadas} unidade(s) já bipada(s) serão descartadas.
                </span>
              )}
            </p>
            <div className="mt-4 space-y-2">
              <button className="btn-danger w-full" onClick={() => cancelarSeparacao(false)} disabled={cancelando}>
                Voltar para a fila
              </button>
              {operador?.supervisor && (
                <button className="btn-secondary w-full" onClick={() => cancelarSeparacao(true)} disabled={cancelando}>
                  Tirar da separação (volta para a triagem)
                </button>
              )}
              <button className="btn-secondary w-full" onClick={() => setCancelar(null)} disabled={cancelando}>Não, continuar</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  )
}
