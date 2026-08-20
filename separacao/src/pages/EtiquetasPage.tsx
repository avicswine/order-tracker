import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import Shell from '../components/Shell'
import { api } from '../lib/api'
import type { Empresa } from '../types'

interface CatalogoItem { id: string; sku: string; nome: string; nfs?: number; unidades?: number; impressoEm?: string | null }
type Fonte = 'pendentes' | 'catalogo' | 'nf'

// Etiqueta de prateleira: layout horizontal (QR à esquerda, SKU/nome à direita), altura máx. 4 cm.
// A "página" pode ser uma folha A4 ou uma etiqueta da impressora Zebra (10×15 cm) — nas duas, várias
// etiquetas de prateleira são impressas por página e recortadas depois.
type Pagina = 'A4' | 'ZEBRA_10x15' | 'PERSONALIZADA'

const PAGINAS: Record<Pagina, { nome: string; larguraMm: number; alturaMm: number }> = {
  A4: { nome: 'Folha A4 (210 × 297 mm)', larguraMm: 210, alturaMm: 297 },
  ZEBRA_10x15: { nome: 'Zebra 10 × 15 cm', larguraMm: 100, alturaMm: 150 },
  PERSONALIZADA: { nome: 'Personalizada', larguraMm: 100, alturaMm: 150 },
}

interface Layout {
  pagina: Pagina
  paginaLarguraMm: number
  paginaAlturaMm: number
  larguraMm: number
  alturaMm: number
  colunas: number
  margemMm: number
  espacoMm: number
  mostrarNome: boolean
}

// Presets por página: Zebra 10×15 → 1 coluna de 90 × 30 mm = 4 etiquetas de prateleira por etiqueta Zebra
const PRESETS: Record<Pagina, Omit<Layout, 'pagina' | 'mostrarNome'>> = {
  A4: { paginaLarguraMm: 210, paginaAlturaMm: 297, larguraMm: 60, alturaMm: 30, colunas: 3, margemMm: 8, espacoMm: 3 },
  ZEBRA_10x15: { paginaLarguraMm: 100, paginaAlturaMm: 150, larguraMm: 90, alturaMm: 30, colunas: 1, margemMm: 4, espacoMm: 4 },
  PERSONALIZADA: { paginaLarguraMm: 100, paginaAlturaMm: 150, larguraMm: 90, alturaMm: 30, colunas: 1, margemMm: 4, espacoMm: 4 },
}

const LAYOUT_PADRAO: Layout = { pagina: 'A4', mostrarNome: true, ...PRESETS.A4 }
const ALTURA_MAX_MM = 40
const CHAVE_LAYOUT = 'separacao_etiquetas_layout'
const CHAVE_EMPRESA = 'separacao_etiquetas_empresa'

function carregarLayout(paginaForcada?: Pagina): Layout {
  let salvo: Layout
  try { salvo = { ...LAYOUT_PADRAO, ...JSON.parse(localStorage.getItem(CHAVE_LAYOUT) || '{}') } } catch { salvo = LAYOUT_PADRAO }
  // ?papel=zebra (atalho da triagem) já abre configurado para a impressora de etiquetas
  if (paginaForcada && salvo.pagina !== paginaForcada) return { ...salvo, pagina: paginaForcada, ...PRESETS[paginaForcada] }
  return salvo
}

export default function EtiquetasPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresa, setEmpresa] = useState(() => localStorage.getItem(CHAVE_EMPRESA) || '')
  const [itens, setItens] = useState<CatalogoItem[]>([])
  const [busca, setBusca] = useState('')
  const [selecionados, setSelecionados] = useState<Map<string, CatalogoItem>>(new Map())
  const [copias, setCopias] = useState<Record<string, number>>({})
  const [layout, setLayout] = useState<Layout>(() => {
    const papel = new URLSearchParams(window.location.search).get('papel')
    return carregarLayout(papel === 'zebra' ? 'ZEBRA_10x15' : papel === 'a4' ? 'A4' : undefined)
  })
  const [qrs, setQrs] = useState<Record<string, string>>({})
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')
  const [msg, setMsg] = useState('')
  const [searchParams] = useSearchParams()
  const [nfId, setNfId] = useState<string | null>(searchParams.get('nf')) // vindo de "Etiquetas desta NF" ou da busca por número
  const [fonte, setFonte] = useState<Fonte>(searchParams.get('nf') ? 'nf' : 'pendentes')
  const [nfInfo, setNfInfo] = useState<{ nfNumero: string } | null>(null)
  const [nfBusca, setNfBusca] = useState('')
  const [diasPendentes, setDiasPendentes] = useState(1)
  const [incluirImpressos, setIncluirImpressos] = useState(false)

  useEffect(() => { api.get<Empresa[]>('/empresas').then(setEmpresas).catch(() => undefined) }, [])
  useEffect(() => { localStorage.setItem(CHAVE_LAYOUT, JSON.stringify(layout)) }, [layout])
  useEffect(() => { if (empresa) localStorage.setItem(CHAVE_EMPRESA, empresa) }, [empresa])

  async function carregarCatalogo(forcar = false) {
    if (!empresa) return
    setCarregando(true); setErro('')
    try {
      const r = await api.get<{ total: number; itens: CatalogoItem[]; atualizadoEm: number | null }>(`/catalogo?empresa=${empresa}${forcar ? '&forcar=1' : ''}`)
      setItens(r.itens)
      setInfo(`${r.total} produtos${r.atualizadoEm ? ` (lista de ${new Date(r.atualizadoEm).toLocaleTimeString('pt-BR')})` : ''}`)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar catálogo')
    } finally {
      setCarregando(false)
    }
  }

  // SKUs físicos das NFs do período ainda sem etiqueta (alimenta a prateleira conforme as NFs chegam)
  async function carregarPendentes() {
    if (!empresa) return
    setCarregando(true); setErro('')
    try {
      const r = await api.get<{ itens: CatalogoItem[]; dias: number; precarga: { carregadas: number; erros: number } }>(
        `/catalogo/pendentes?empresa=${empresa}&dias=${diasPendentes}${incluirImpressos ? '&todos=1' : ''}`)
      setItens(r.itens.map(i => ({ ...i, id: i.sku })))
      const semEtiqueta = r.itens.filter(i => !i.impressoEm).length
      setInfo(`${r.itens.length} SKU(s) nas NFs ${diasPendentes === 1 ? 'de hoje' : `dos últimos ${diasPendentes} dias`} · ${semEtiqueta} sem etiqueta${r.precarga.carregadas ? ` · ${r.precarga.carregadas} NF(s) processada(s) agora` : ''}`)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar pendentes')
    } finally {
      setCarregando(false)
    }
  }

  // SKUs de uma NF específica — pré-seleciona os que ainda não têm etiqueta impressa
  async function carregarDaNf() {
    if (!nfId) return
    setCarregando(true); setErro('')
    try {
      const r = await api.get<{ companyKey: string; nfNumero: string; itens: CatalogoItem[] }>(`/catalogo/nf/${nfId}`)
      if (r.companyKey !== empresa) setEmpresa(r.companyKey)
      setNfInfo({ nfNumero: r.nfNumero })
      const lista = r.itens.map(i => ({ ...i, id: i.sku }))
      setItens(lista)
      const semEtiqueta = lista.filter(i => !i.impressoEm)
      setSelecionados(new Map((incluirImpressos ? lista : semEtiqueta).map(i => [i.id, i])))
      setInfo(`NF ${r.nfNumero}: ${lista.length} SKU(s) · ${semEtiqueta.length} sem etiqueta${incluirImpressos ? ' · todos selecionados' : semEtiqueta.length ? ' (já selecionados)' : ''}`)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar NF')
    } finally {
      setCarregando(false)
    }
  }

  // Busca a NF pelo número/chave (na empresa escolhida) e carrega os SKUs dela
  async function buscarNf(e?: FormEvent) {
    e?.preventDefault()
    const codigo = nfBusca.trim()
    if (!codigo) return
    setErro(''); setMsg('')
    try {
      const r = await api.get<{ tarefas: { id: string; nfNumero: string; status: string }[] }>(`/tarefas/localizar?codigo=${encodeURIComponent(codigo)}${empresa ? `&empresa=${empresa}` : ''}`)
      if (r.tarefas.length === 0) { setItens([]); setNfInfo(null); return setErro('NF não encontrada na fila de separação. Use Balcão → Triagem → "Buscar NF no Bling" para importá-la.') }
      setNfId(r.tarefas[0].id)
      setNfBusca('')
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao localizar NF')
    }
  }

  const recarregar = (forcar = false) => (fonte === 'nf' ? carregarDaNf() : fonte === 'pendentes' ? carregarPendentes() : carregarCatalogo(forcar))
  useEffect(() => { if (fonte !== 'nf') setSelecionados(new Map()); recarregar() }, [empresa, fonte, diasPendentes, incluirImpressos, nfId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function marcarImpressas(skus: string[]) {
    if (!empresa || skus.length === 0) return
    try {
      const r = await api.post<{ marcadas: number }>('/catalogo/pendentes/marcar', { empresa, skus })
      setMsg(`${r.marcadas} SKU(s) marcados como impressos.`)
      setSelecionados(new Map())
      await recarregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao marcar')
    }
  }

  function imprimir() {
    window.print()
    // Nas abas "Pendentes" e "Por NF", depois de fechar a janela de impressão, oferece registrar como impressas
    if (fonte !== 'catalogo' && selecionados.size > 0) {
      const skus = [...selecionados.values()].map(i => i.sku)
      if (window.confirm(`Imprimiu? Marcar ${skus.length} SKU(s) como etiqueta impressa (somem da lista de pendentes)?`)) marcarImpressas(skus)
    }
  }

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase()
    const lista = b ? itens.filter(i => `${i.sku} ${i.nome}`.toLowerCase().includes(b)) : itens
    return lista.slice(0, 300)
  }, [itens, busca])

  // Gera os QR Codes (conteúdo = SKU) dos selecionados
  useEffect(() => {
    let cancelado = false
    ;(async () => {
      const novos: Record<string, string> = {}
      for (const item of selecionados.values()) {
        if (qrs[item.sku]) continue
        novos[item.sku] = await QRCode.toDataURL(item.sku, { margin: 0, errorCorrectionLevel: 'M', width: 300 })
      }
      if (!cancelado && Object.keys(novos).length) setQrs(q => ({ ...q, ...novos }))
    })()
    return () => { cancelado = true }
  }, [selecionados]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (item: CatalogoItem) => setSelecionados(s => {
    const n = new Map(s)
    n.has(item.id) ? n.delete(item.id) : n.set(item.id, item)
    return n
  })

  const etiquetas = useMemo(() => {
    const lista: CatalogoItem[] = []
    for (const item of selecionados.values()) {
      const n = Math.max(1, copias[item.id] ?? 1)
      for (let i = 0; i < n; i++) lista.push(item)
    }
    return lista
  }, [selecionados, copias])

  const alturaOk = layout.alturaMm <= ALTURA_MAX_MM
  const set = (k: keyof Layout, v: number | boolean | string) => setLayout(l => ({ ...l, [k]: v }))
  const qrMm = layout.alturaMm - 4

  // Trocar de página aplica o preset daquela página (a pessoa ajusta depois se quiser)
  const aplicarPagina = (p: Pagina) => setLayout(l => ({ ...l, pagina: p, ...PRESETS[p] }))

  const larguraUtil = layout.paginaLarguraMm - 2 * layout.margemMm
  const alturaUtil = layout.paginaAlturaMm - 2 * layout.margemMm
  const cabeNaLargura = layout.colunas * layout.larguraMm + (layout.colunas - 1) * layout.espacoMm <= larguraUtil + 0.01
  const linhasPorPagina = Math.max(0, Math.floor((alturaUtil + layout.espacoMm) / (layout.alturaMm + layout.espacoMm)))
  const porPagina = linhasPorPagina * layout.colunas

  return (
    <Shell titulo="Etiquetas de prateleira" voltarPara="/" largura="max-w-6xl">
      {/* Estilos de impressão: só a folha de etiquetas sai no papel */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #folha-etiquetas, #folha-etiquetas * { visibility: visible; }
          #folha-etiquetas { position: absolute; left: 0; top: 0; margin: 0 !important; padding: 0 !important; box-shadow: none !important; border: 0 !important; min-height: 0 !important; }
          @page { size: ${layout.paginaLarguraMm}mm ${layout.paginaAlturaMm}mm; margin: ${layout.margemMm}mm; }
        }
      `}</style>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 print:hidden">
        {/* Seleção */}
        <div className="card p-4">
          <div className="flex gap-2 mb-2">
            <select className="input !py-2 !text-base" value={empresa} onChange={e => setEmpresa(e.target.value)}>
              <option value="">Empresa…</option>
              {empresas.map(e => <option key={e.key} value={e.key}>{e.name}</option>)}
            </select>
            <button className="btn-secondary !py-2 shrink-0" onClick={() => recarregar(true)} disabled={!empresa || carregando}>⟳</button>
          </div>
          <div className="flex gap-1 mb-2 bg-slate-100 rounded-xl p-1 text-sm">
            <button className={`flex-1 rounded-lg py-1.5 ${fonte === 'pendentes' ? 'bg-white shadow font-medium' : 'text-slate-600'}`} onClick={() => setFonte('pendentes')}>Pendentes do dia</button>
            <button className={`flex-1 rounded-lg py-1.5 ${fonte === 'nf' ? 'bg-white shadow font-medium' : 'text-slate-600'}`} onClick={() => setFonte('nf')}>Por NF</button>
            <button className={`flex-1 rounded-lg py-1.5 ${fonte === 'catalogo' ? 'bg-white shadow font-medium' : 'text-slate-600'}`} onClick={() => setFonte('catalogo')}>Catálogo completo</button>
          </div>
          {fonte === 'nf' && (
            <div className="mb-2">
              <form onSubmit={buscarNf} className="flex gap-2 mb-1">
                <input className="input !py-1.5 !text-base" placeholder="Nº da NF ou bipe a DANFE" inputMode="numeric" value={nfBusca} onChange={e => setNfBusca(e.target.value)} />
                <button className="btn-secondary !py-1.5 shrink-0">Buscar</button>
              </form>
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{nfInfo ? <>NF <b>{nfInfo.nfNumero}</b> carregada — os SKUs sem etiqueta já vêm selecionados.</> : 'Digite o número da NF para listar os SKUs dela.'}</span>
                <label className="flex items-center gap-1"><input type="checkbox" checked={incluirImpressos} onChange={e => setIncluirImpressos(e.target.checked)} /> selecionar também já impressos</label>
              </div>
            </div>
          )}
          {fonte === 'pendentes' && (
            <div className="flex items-center gap-3 text-xs text-slate-600 mb-2 flex-wrap">
              <span>NFs de:</span>
              {[1, 2, 7].map(d => (
                <button key={d} className={`px-2 py-0.5 rounded-full border ${diasPendentes === d ? 'bg-brand-600 text-white border-brand-600' : 'bg-white'}`} onClick={() => setDiasPendentes(d)}>{d === 1 ? 'hoje' : `${d} dias`}</button>
              ))}
              <label className="flex items-center gap-1 ml-auto"><input type="checkbox" checked={incluirImpressos} onChange={e => setIncluirImpressos(e.target.checked)} /> mostrar já impressos</label>
            </div>
          )}
          <input className="input !py-2 !text-base mb-2" placeholder="Buscar por SKU ou nome" value={busca} onChange={e => setBusca(e.target.value)} />
          <div className="text-xs text-slate-500 mb-2 flex justify-between gap-2">
            <span>{carregando ? (fonte === 'pendentes' ? 'Processando NFs do período…' : 'Carregando catálogo do Bling…') : info}</span>
            <span className="whitespace-nowrap">
              <button className="text-brand-700 mr-3" onClick={() => setSelecionados(s => { const n = new Map(s); filtrados.forEach(i => n.set(i.id, i)); return n })}>Selecionar visíveis</button>
              <button className="text-slate-500" onClick={() => setSelecionados(new Map())}>Limpar</button>
            </span>
          </div>
          {erro && <div className="rounded-xl bg-red-50 text-red-700 px-3 py-2 text-sm mb-2">{erro}</div>}
          {msg && <div className="rounded-xl bg-green-50 text-green-700 px-3 py-2 text-sm mb-2">{msg}</div>}
          <div className="max-h-[28rem] overflow-y-auto border border-slate-200 rounded-xl">
            {filtrados.map(item => (
              <label key={item.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-100 text-sm cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={selecionados.has(item.id)} onChange={() => toggle(item)} />
                <span className="font-semibold w-32 shrink-0 truncate">{item.sku}</span>
                <span className="flex-1 truncate text-slate-700">{item.nome}</span>
                {fonte !== 'catalogo' && item.nfs !== undefined && (
                  <span className={`text-xs whitespace-nowrap ${item.impressoEm ? 'text-green-700' : 'text-slate-400'}`} title={item.impressoEm ? `impresso em ${new Date(item.impressoEm).toLocaleDateString('pt-BR')}` : ''}>
                    {item.impressoEm ? '✔ impresso · ' : ''}{item.nfs} NF · {item.unidades} un.
                  </span>
                )}
                {selecionados.has(item.id) && (
                  <input type="number" min={1} max={99} className="w-14 border rounded px-1 text-center" value={copias[item.id] ?? 1}
                    onChange={e => setCopias(c => ({ ...c, [item.id]: Number(e.target.value) }))} onClick={e => e.preventDefault()} title="cópias" />
                )}
              </label>
            ))}
            {!carregando && filtrados.length === 0 && (
              <div className="p-4 text-center text-slate-500 text-sm">
                {!empresa && fonte !== 'nf' ? 'Selecione a empresa' : fonte === 'pendentes' ? 'Nenhum SKU pendente — todas as etiquetas das NFs do período já foram impressas.' : fonte === 'nf' ? 'Nenhuma NF carregada.' : 'Nenhum produto'}
              </div>
            )}
          </div>
          {fonte !== 'catalogo' && selecionados.size > 0 && (
            <button className="btn-secondary w-full mt-2 !py-2 text-sm" onClick={() => marcarImpressas([...selecionados.values()].map(i => i.sku))}>
              Marcar {selecionados.size} selecionado(s) como impressos (sem imprimir)
            </button>
          )}
        </div>

        {/* Layout */}
        <div className="card p-4">
          <div className="font-semibold mb-2">Papel / impressora</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm mb-4">
            <label className="col-span-2 sm:col-span-1">Página
              <select className="input !py-1.5 !text-base" value={layout.pagina} onChange={e => aplicarPagina(e.target.value as Pagina)}>
                {(Object.keys(PAGINAS) as Pagina[]).map(p => <option key={p} value={p}>{PAGINAS[p].nome}</option>)}
              </select>
            </label>
            <label>Largura da página (mm)<input type="number" className="input !py-1.5 !text-base" value={layout.paginaLarguraMm} min={30} max={300} disabled={layout.pagina !== 'PERSONALIZADA'} onChange={e => set('paginaLarguraMm', Number(e.target.value))} /></label>
            <label>Altura da página (mm)<input type="number" className="input !py-1.5 !text-base" value={layout.paginaAlturaMm} min={30} max={420} disabled={layout.pagina !== 'PERSONALIZADA'} onChange={e => set('paginaAlturaMm', Number(e.target.value))} /></label>
          </div>

          <div className="font-semibold mb-2">Layout da etiqueta <span className="text-slate-500 font-normal text-sm">(altura máx. {ALTURA_MAX_MM} mm)</span></div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <label>Largura (mm)<input type="number" className="input !py-1.5 !text-base" value={layout.larguraMm} min={20} max={200} onChange={e => set('larguraMm', Number(e.target.value))} /></label>
            <label>Altura (mm)<input type="number" className={`input !py-1.5 !text-base ${alturaOk ? '' : '!border-red-500'}`} value={layout.alturaMm} min={15} max={ALTURA_MAX_MM} onChange={e => set('alturaMm', Number(e.target.value))} /></label>
            <label>Colunas<input type="number" className="input !py-1.5 !text-base" value={layout.colunas} min={1} max={8} onChange={e => set('colunas', Number(e.target.value))} /></label>
            <label>Margem da folha (mm)<input type="number" className="input !py-1.5 !text-base" value={layout.margemMm} min={0} max={30} onChange={e => set('margemMm', Number(e.target.value))} /></label>
            <label>Espaço entre (mm)<input type="number" className="input !py-1.5 !text-base" value={layout.espacoMm} min={0} max={20} onChange={e => set('espacoMm', Number(e.target.value))} /></label>
            <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={layout.mostrarNome} onChange={e => set('mostrarNome', e.target.checked)} /> Mostrar nome</label>
          </div>
          {!alturaOk && <div className="text-red-600 text-sm mt-2">Altura acima do máximo permitido para a prateleira.</div>}
          {!cabeNaLargura && <div className="text-red-600 text-sm mt-2">As {layout.colunas} coluna(s) de {layout.larguraMm} mm não cabem na largura da página ({layout.paginaLarguraMm} mm menos margens).</div>}
          <div className="text-xs text-slate-500 mt-2">{porPagina} etiqueta(s) por página → {etiquetas.length > 0 ? Math.ceil(etiquetas.length / Math.max(porPagina, 1)) : 0} página(s)</div>
          <div className="mt-4 flex items-center gap-3">
            <button className="btn-primary" disabled={etiquetas.length === 0 || !alturaOk || !cabeNaLargura} onClick={imprimir}>🖨 Imprimir {etiquetas.length} etiqueta(s)</button>
            <span className="text-xs text-slate-500">
              {layout.pagina === 'ZEBRA_10x15'
                ? 'Na janela de impressão: escolha a Zebra, papel 100 × 150 mm (4" × 6"), margens "Nenhuma", escala 100%, sem cabeçalho/rodapé.'
                : 'Na janela de impressão: escolha a impressora, o papel correspondente, margens "Nenhuma" e desative cabeçalho/rodapé.'}
            </span>
          </div>
        </div>
      </div>

      {/* Folha (pré-visualização + impressão) */}
      <div className="mt-4 print:hidden text-xs uppercase tracking-wide text-slate-500">Pré-visualização</div>
      <div id="folha-etiquetas" className="bg-white shadow border border-slate-200 mx-auto mt-1" style={{ width: `${layout.paginaLarguraMm}mm`, minHeight: `${layout.paginaAlturaMm}mm`, padding: `${layout.margemMm}mm`, boxSizing: 'border-box' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${layout.colunas}, ${layout.larguraMm}mm)`, gap: `${layout.espacoMm}mm` }}>
          {etiquetas.map((item, i) => (
            <div key={`${item.id}-${i}`} style={{ width: `${layout.larguraMm}mm`, height: `${layout.alturaMm}mm`, border: '0.2mm dashed #bbb', boxSizing: 'border-box', padding: '2mm', display: 'flex', gap: '2mm', alignItems: 'center', overflow: 'hidden', pageBreakInside: 'avoid' }}>
              {qrs[item.sku] ? <img src={qrs[item.sku]} alt={item.sku} style={{ width: `${qrMm}mm`, height: `${qrMm}mm`, flexShrink: 0 }} /> : <div style={{ width: `${qrMm}mm`, height: `${qrMm}mm`, background: '#eee' }} />}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: `${Math.min(6, layout.alturaMm / 4)}mm`, lineHeight: 1.05, wordBreak: 'break-all' }}>{item.sku}</div>
                {layout.mostrarNome && <div style={{ fontSize: '2.6mm', lineHeight: 1.15, marginTop: '1mm', color: '#333', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{item.nome}</div>}
              </div>
            </div>
          ))}
        </div>
        {etiquetas.length === 0 && <div className="text-slate-400 text-sm p-4 print:hidden">Selecione produtos para ver as etiquetas aqui.</div>}
      </div>
    </Shell>
  )
}
