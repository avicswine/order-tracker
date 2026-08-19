import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Shell from '../components/Shell'
import ScannerQr from '../components/ScannerQr'
import { BadgeStatus } from '../components/TarefaCard'
import { api } from '../lib/api'
import { useEventos } from '../lib/useEventos'
import { destravarAudio, feedbackAviso, feedbackConcluido, feedbackErro, feedbackOk, getVozAtiva, setVozAtiva } from '../lib/feedback'
import type { Config, Item, ResultadoBipe, Tarefa } from '../types'

const CHAVE_CAMERA = 'separacao_camera'
const OVERLAY_MS = 1400

// ok = verde · erro = vermelho (item não é da NF / qtd divergente) · aviso = laranja (não é o item selecionado) · concluido = NF pronta
type Overlay = { tipo: 'ok' | 'erro' | 'aviso' | 'concluido'; titulo: string; detalhe?: string } | null

function fmtQtd(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '')
}

export default function SepararTarefaPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [tarefa, setTarefa] = useState<Tarefa | null>(null)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [erro, setErro] = useState('')
  const [codigo, setCodigo] = useState('')
  const [camera, setCamera] = useState(() => localStorage.getItem(CHAVE_CAMERA) !== '0')
  const [voz, setVoz] = useState(getVozAtiva())
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [itemQtd, setItemQtd] = useState<Item | null>(null)
  const [qtdDigitada, setQtdDigitada] = useState('')
  const [itemFoto, setItemFoto] = useState<Item | null>(null)
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null) // item tocado na lista: só ele é aceito no bipe
  const [enviando, setEnviando] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayTimer = useRef<number | undefined>(undefined)
  const selecionadoRef = useRef<string | null>(null)
  selecionadoRef.current = selecionadoId

  const carregar = useCallback(async () => {
    if (!id) return
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

  useEffect(() => { localStorage.setItem(CHAVE_CAMERA, camera ? '1' : '0') }, [camera])
  useEffect(() => { setVozAtiva(voz) }, [voz])

  function mostrarOverlay(o: Overlay) {
    setOverlay(o)
    window.clearTimeout(overlayTimer.current)
    overlayTimer.current = window.setTimeout(() => setOverlay(null), OVERLAY_MS)
  }

  const bipar = useCallback(async (valor: string, qtd?: number) => {
    if (!id || !valor.trim() || enviando) return
    setEnviando(true)
    destravarAudio()
    try {
      const r = await api.post<ResultadoBipe>(`/tarefas/${id}/bipar`, {
        codigo: valor,
        ...(qtd !== undefined ? { qtd } : {}),
        ...(selecionadoRef.current ? { itemSelecionadoId: selecionadoRef.current } : {}),
      })
      // Atualiza item local imediatamente (resposta rápida) e recarrega em seguida
      if (r.item) {
        setTarefa(t => t ? {
          ...t,
          progresso: r.progresso,
          status: r.tarefaSeparada ? 'SEPARADO' : t.status,
          itens: t.itens.map(i => i.id === r.item!.id ? { ...i, qtdBipada: r.item!.qtdBipada, qtdManual: qtd !== undefined || i.qtdManual, concluidoEm: r.item!.concluido ? new Date().toISOString() : null } : i),
        } : t)
      }
      if (r.ok) {
        const it = r.item!
        if (it.concluido) setSelecionadoId(null) // item terminou → libera a seleção
        if (r.tarefaSeparada) {
          feedbackConcluido('Nota separada. Leve ao balcão.')
          mostrarOverlay({ tipo: 'concluido', titulo: 'NF separada!', detalhe: 'Leve ao balcão' })
        } else if (it.concluido) {
          feedbackOk('Item completo')
          mostrarOverlay({ tipo: 'ok', titulo: `${it.sku} completo`, detalhe: it.nome })
        } else {
          const falta = it.qtdEsperada - it.qtdBipada
          feedbackOk(`Correto. Falta${falta === 1 ? '' : 'm'} ${fmtQtd(falta)}`)
          mostrarOverlay({ tipo: 'ok', titulo: `${fmtQtd(it.qtdBipada)} de ${fmtQtd(it.qtdEsperada)}`, detalhe: it.nome })
        }
      } else {
        const fala =
          r.motivo === 'ITEM_NAO_PERTENCE' ? 'Item errado'
          : r.motivo === 'ITEM_DIFERENTE_SELECIONADO' ? 'Não é o item selecionado'
          : r.motivo === 'ITEM_COMPLETO' ? 'Item já completo'
          : r.motivo === 'BIPE_ANTES_DA_QTD' ? 'Bipe o item primeiro'
          : 'Confira a quantidade'
        if (r.motivo === 'ITEM_DIFERENTE_SELECIONADO') {
          feedbackAviso(fala)
          mostrarOverlay({ tipo: 'aviso', titulo: 'NÃO É O SELECIONADO', detalhe: r.mensagem })
        } else {
          feedbackErro(fala)
          mostrarOverlay({ tipo: 'erro', titulo: r.motivo === 'ITEM_NAO_PERTENCE' ? 'ITEM ERRADO' : 'ATENÇÃO', detalhe: r.mensagem })
        }
      }
      if (r.tarefaSeparada) carregar()
    } catch (e) {
      feedbackErro()
      mostrarOverlay({ tipo: 'erro', titulo: 'Erro', detalhe: e instanceof Error ? e.message : 'Falha ao registrar' })
    } finally {
      setEnviando(false)
    }
  }, [id, enviando, carregar])

  function enviarCampo(e: FormEvent) {
    e.preventDefault()
    const v = codigo.trim()
    setCodigo('')
    if (v) bipar(v)
    inputRef.current?.focus()
  }

  function confirmarQtd(e: FormEvent) {
    e.preventDefault()
    if (!itemQtd) return
    const q = Number(qtdDigitada.replace(',', '.'))
    if (!Number.isFinite(q) || q <= 0) return
    const item = itemQtd
    setItemQtd(null); setQtdDigitada('')
    bipar(item.sku, q)
  }

  async function zerar(item: Item) {
    if (!id) return
    if (!window.confirm(`Zerar a contagem de ${item.sku}?`)) return
    try {
      setTarefa(await api.post<Tarefa>(`/tarefas/${id}/itens/${item.id}/zerar`))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao zerar')
    }
  }

  const { pendentes, concluidos } = useMemo(() => {
    const itens = tarefa?.itens ?? []
    return {
      pendentes: itens.filter(i => !i.concluidoEm),
      concluidos: itens.filter(i => !!i.concluidoEm),
    }
  }, [tarefa])

  if (!tarefa) {
    return <Shell titulo="Separar" voltarPara="/separar"><div className="text-slate-500">{erro || 'Carregando…'}</div></Shell>
  }

  const p = tarefa.progresso
  const pct = p.unidadesEsperadas > 0 ? Math.round((p.unidadesBipadas / p.unidadesEsperadas) * 100) : 0
  const separada = tarefa.status === 'SEPARADO' || tarefa.status === 'CONCLUIDO'
  const limite = cfg?.limiteBipeUnitario ?? 5

  return (
    <Shell titulo={`NF ${tarefa.nfNumero} · ${tarefa.empresa?.code ?? ''}`} voltarPara="/separar">
      {/* Cabeçalho da NF */}
      <div className="card p-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{tarefa.clienteNome}</div>
            <div className="text-xs text-slate-500">{tarefa.canal ?? ''} {tarefa.operador ? `· ${tarefa.operador.nome}` : ''}</div>
          </div>
          <BadgeStatus status={tarefa.status} />
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-500">
          <span>{p.concluidos}/{p.total} itens</span><span>{fmtQtd(p.unidadesBipadas)}/{fmtQtd(p.unidadesEsperadas)} un.</span>
        </div>
        <div className="h-2 bg-slate-200 rounded-full overflow-hidden mt-1">
          <div className={`h-full transition-all ${p.completo ? 'bg-green-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
        </div>
      </div>

      {separada && (
        <div className="rounded-2xl bg-green-600 text-white p-5 text-center mb-3">
          <div className="text-2xl font-bold">✔ NF separada</div>
          <div className="text-green-100 mt-1">Leve os itens ao balcão para conferência e finalização.</div>
          <button className="btn-secondary mt-4 w-full" onClick={() => navigate('/separar')}>Voltar à fila</button>
        </div>
      )}

      {!separada && (
        <>
          {/* Leitor */}
          <div className="flex gap-2 mb-2">
            <button className={`btn-secondary flex-1 !py-2 ${camera ? '!bg-brand-50 !border-brand-500' : ''}`} onClick={() => { destravarAudio(); setCamera(c => !c) }}>
              {camera ? '📷 Câmera ligada' : '📷 Ligar câmera'}
            </button>
            <button className={`btn-secondary !py-2 ${voz ? '!bg-brand-50 !border-brand-500' : ''}`} onClick={() => setVoz(v => !v)} title="Voz">
              {voz ? '🔊' : '🔇'}
            </button>
          </div>
          <div className="mb-2"><ScannerQr ativo={camera} onCodigo={v => bipar(v)} /></div>

          <form onSubmit={enviarCampo} className="flex gap-2 mb-4">
            <input
              ref={inputRef}
              className="input"
              placeholder="Bipe ou digite o SKU"
              value={codigo}
              onChange={e => setCodigo(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              autoFocus={!camera}
            />
            <button className="btn-primary shrink-0" disabled={enviando}>OK</button>
          </form>
        </>
      )}

      {erro && <div className="rounded-xl bg-red-50 text-red-700 px-4 py-2 text-sm mb-3">{erro}</div>}

      {/* Item selecionado (toque na lista) */}
      {!separada && selecionadoId && (() => {
        const sel = tarefa.itens.find(i => i.id === selecionadoId)
        return sel ? (
          <div className="rounded-xl bg-orange-50 border border-orange-300 text-orange-900 px-3 py-2 mb-2 flex items-center gap-2 text-sm">
            <span className="flex-1">Separando agora: <b>{sel.sku}</b> — só este QR será aceito</span>
            <button className="underline" onClick={() => setSelecionadoId(null)}>liberar</button>
          </div>
        ) : null
      })()}

      {/* Itens pendentes — toque no item para selecioná-lo (só ele passa a ser aceito) */}
      {pendentes.length > 0 && <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">A separar ({pendentes.length}) · toque no item para travar a seleção</div>}
      <div className="space-y-2 mb-4">
        {pendentes.map((item, idx) => {
          const falta = item.qtdEsperada - item.qtdBipada
          const permiteQtd = item.qtdEsperada > limite
          const selecionado = item.id === selecionadoId
          const sugerido = !selecionadoId && idx === 0
          return (
            <div
              key={item.id}
              onClick={() => !separada && setSelecionadoId(selecionado ? null : item.id)}
              className={`card p-3 cursor-pointer ${selecionado ? 'border-orange-400 ring-2 ring-orange-200 bg-orange-50' : sugerido ? 'border-brand-500 ring-2 ring-brand-100' : ''}`}
            >
              <div className="flex gap-3">
                <button className="w-16 h-16 rounded-xl bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center text-slate-400 text-xs" onClick={e => { e.stopPropagation(); if (item.fotoUrl) setItemFoto(item) }}>
                  {item.fotoUrl ? <img src={item.fotoUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : 'sem foto'}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-xl leading-tight">{item.sku}{selecionado && <span className="ml-2 text-xs font-semibold bg-orange-500 text-white rounded px-1.5 py-0.5 align-middle">SELECIONADO</span>}</div>
                  <div className="text-sm text-slate-700 leading-snug">{item.nome}</div>
                  {item.origemKit && <div className="text-xs text-slate-400 mt-0.5">de: {item.origemKit}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-3xl font-bold text-brand-700 leading-none">{fmtQtd(falta)}</div>
                  <div className="text-xs text-slate-500">{item.qtdBipada > 0 ? `${fmtQtd(item.qtdBipada)}/${fmtQtd(item.qtdEsperada)}` : 'a separar'}</div>
                </div>
              </div>
              {!separada && (permiteQtd || item.qtdBipada > 0) && (
                <div className="flex gap-2 mt-2" onClick={e => e.stopPropagation()}>
                  {permiteQtd && item.qtdBipada > 0 && (
                    <button className="btn-secondary flex-1 !py-2 text-sm" onClick={() => { setItemQtd(item); setQtdDigitada('') }}>
                      Já contei — digitar quantidade ({fmtQtd(falta)} faltam)
                    </button>
                  )}
                  {permiteQtd && item.qtdBipada === 0 && (
                    <div className="flex-1 text-xs text-slate-500 py-2">Bipe o QR deste item 1 vez para liberar "digitar quantidade"</div>
                  )}
                  {item.qtdBipada > 0 && <button className="btn-secondary !py-2 text-sm" onClick={() => zerar(item)}>Zerar</button>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Itens concluídos */}
      {concluidos.length > 0 && <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Separados ({concluidos.length})</div>}
      <div className="space-y-2">
        {concluidos.map(item => (
          <div key={item.id} className="card p-3 flex items-center gap-3 bg-green-50 border-green-200">
            <div className="text-green-600 text-2xl">✔</div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{item.sku} <span className="text-slate-500 font-normal">× {fmtQtd(item.qtdEsperada)}</span>{item.qtdManual && <span className="ml-2 text-xs bg-amber-100 text-amber-800 rounded px-1.5">qtd digitada</span>}</div>
              <div className="text-xs text-slate-600 truncate">{item.nome}</div>
            </div>
            {tarefa.status !== 'CONCLUIDO' && <button className="btn-secondary !py-1.5 !px-3 text-xs" onClick={() => zerar(item)}>Zerar</button>}
          </div>
        ))}
      </div>

      {/* Overlay de feedback */}
      {overlay && (
        <div
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center text-white text-center p-8 pointer-events-none
            ${overlay.tipo === 'erro' ? 'bg-red-600/95' : overlay.tipo === 'aviso' ? 'bg-orange-500/95' : overlay.tipo === 'concluido' ? 'bg-emerald-600/95' : 'bg-green-600/90'}`}
        >
          <div className="text-6xl mb-3">{overlay.tipo === 'erro' ? '✖' : overlay.tipo === 'aviso' ? '⚠' : '✔'}</div>
          <div className="text-4xl font-bold">{overlay.titulo}</div>
          {overlay.detalhe && <div className="text-lg mt-2 opacity-90">{overlay.detalhe}</div>}
        </div>
      )}

      {/* Modal quantidade digitada */}
      {itemQtd && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={() => setItemQtd(null)}>
          <form onSubmit={confirmarQtd} className="card w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <div className="font-bold text-lg">{itemQtd.sku}</div>
            <div className="text-sm text-slate-600 mb-3">{itemQtd.nome}</div>
            <div className="text-sm text-slate-500 mb-1">Quantas unidades você separou? (esperado: {fmtQtd(itemQtd.qtdEsperada - itemQtd.qtdBipada)})</div>
            <input className="input text-3xl text-center" inputMode="decimal" autoFocus value={qtdDigitada} onChange={e => setQtdDigitada(e.target.value)} />
            <div className="flex gap-2 mt-4">
              <button type="button" className="btn-secondary flex-1" onClick={() => setItemQtd(null)}>Cancelar</button>
              <button type="submit" className="btn-primary flex-1">Confirmar</button>
            </div>
          </form>
        </div>
      )}

      {/* Foto ampliada */}
      {itemFoto?.fotoUrl && (
        <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-4" onClick={() => setItemFoto(null)}>
          <div className="text-center">
            <img src={itemFoto.fotoUrl} alt={itemFoto.sku} className="max-h-[70vh] max-w-full rounded-xl mx-auto" />
            <div className="text-white mt-3 font-semibold">{itemFoto.sku} — {itemFoto.nome}</div>
          </div>
        </div>
      )}
    </Shell>
  )
}
