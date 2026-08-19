import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import Shell from '../components/Shell'
import { api } from '../lib/api'
import type { Empresa } from '../types'

interface CatalogoItem { id: string; sku: string; nome: string }

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

function carregarLayout(): Layout {
  try { return { ...LAYOUT_PADRAO, ...JSON.parse(localStorage.getItem(CHAVE_LAYOUT) || '{}') } } catch { return LAYOUT_PADRAO }
}

export default function EtiquetasPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresa, setEmpresa] = useState(() => localStorage.getItem(CHAVE_EMPRESA) || '')
  const [itens, setItens] = useState<CatalogoItem[]>([])
  const [busca, setBusca] = useState('')
  const [selecionados, setSelecionados] = useState<Map<string, CatalogoItem>>(new Map())
  const [copias, setCopias] = useState<Record<string, number>>({})
  const [layout, setLayout] = useState<Layout>(carregarLayout)
  const [qrs, setQrs] = useState<Record<string, string>>({})
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState('')

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
  useEffect(() => { carregarCatalogo() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps

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
            <button className="btn-secondary !py-2 shrink-0" onClick={() => carregarCatalogo(true)} disabled={!empresa || carregando}>⟳</button>
          </div>
          <input className="input !py-2 !text-base mb-2" placeholder="Buscar por SKU ou nome" value={busca} onChange={e => setBusca(e.target.value)} />
          <div className="text-xs text-slate-500 mb-2 flex justify-between">
            <span>{carregando ? 'Carregando catálogo do Bling…' : info}</span>
            <span>
              <button className="text-brand-700 mr-3" onClick={() => setSelecionados(s => { const n = new Map(s); filtrados.forEach(i => n.set(i.id, i)); return n })}>Selecionar visíveis</button>
              <button className="text-slate-500" onClick={() => setSelecionados(new Map())}>Limpar</button>
            </span>
          </div>
          {erro && <div className="rounded-xl bg-red-50 text-red-700 px-3 py-2 text-sm mb-2">{erro}</div>}
          <div className="max-h-[28rem] overflow-y-auto border border-slate-200 rounded-xl">
            {filtrados.map(item => (
              <label key={item.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-100 text-sm cursor-pointer hover:bg-slate-50">
                <input type="checkbox" checked={selecionados.has(item.id)} onChange={() => toggle(item)} />
                <span className="font-semibold w-32 shrink-0 truncate">{item.sku}</span>
                <span className="flex-1 truncate text-slate-700">{item.nome}</span>
                {selecionados.has(item.id) && (
                  <input type="number" min={1} max={99} className="w-14 border rounded px-1 text-center" value={copias[item.id] ?? 1}
                    onChange={e => setCopias(c => ({ ...c, [item.id]: Number(e.target.value) }))} onClick={e => e.preventDefault()} title="cópias" />
                )}
              </label>
            ))}
            {!carregando && filtrados.length === 0 && <div className="p-4 text-center text-slate-500 text-sm">{empresa ? 'Nenhum produto' : 'Selecione a empresa'}</div>}
          </div>
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
            <button className="btn-primary" disabled={etiquetas.length === 0 || !alturaOk || !cabeNaLargura} onClick={() => window.print()}>🖨 Imprimir {etiquetas.length} etiqueta(s)</button>
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
