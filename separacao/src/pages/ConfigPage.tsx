import { useEffect, useState, type FormEvent } from 'react'
import Shell from '../components/Shell'
import { api } from '../lib/api'
import type { Config, Diagnostico } from '../types'

const RECURSO_LABEL: Record<string, { nome: string; usoNoApp: string }> = {
  'nfe': { nome: 'Notas fiscais', usoNoApp: 'obrigatório — fila e itens da NF' },
  'produtos': { nome: 'Produtos', usoNoApp: 'kits (composição), fotos, peso e catálogo de etiquetas' },
  'canais-venda': { nome: 'Canais de venda', usoNoApp: 'nome do canal (Site, Mercado Livre…) — opcional, dá para nomear abaixo' },
}

export default function ConfigPage() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [canaisVistos, setCanaisVistos] = useState<{ canal: string; quantidade: number }[]>([])
  const [diag, setDiag] = useState<Diagnostico | null>(null)
  const [impressas, setImpressas] = useState<{ companyKey: string; total: number }[] | null>(null)
  const [diagnosticando, setDiagnosticando] = useState(false)

  useEffect(() => {
    api.get<Config>('/config').then(setCfg).catch(e => setErro(e.message))
    api.get<{ canal: string; quantidade: number }[]>('/tarefas/canais').then(setCanaisVistos).catch(() => undefined)
    carregarImpressas()
  }, [])

  function carregarImpressas() {
    api.get<{ companyKey: string; total: number }[]>('/catalogo/impressas').then(setImpressas).catch(() => setImpressas([]))
  }

  async function limparEtiquetas() {
    if (!window.confirm('Zerar o registro de etiquetas impressas de TODAS as empresas?\n\nTodos os SKUs voltam a aparecer como pendentes de etiqueta. Use quando a etiquetagem começar de verdade.')) return
    setMsg(''); setErro('')
    try {
      const r = await api.delete<{ removidas: number }>('/catalogo/impressas')
      setMsg(`Registro zerado (${r.removidas} SKU(s)). Todos voltam a aparecer como pendentes de etiqueta.`)
      carregarImpressas()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao limpar')
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!cfg) return
    setMsg(''); setErro('')
    try {
      setCfg(await api.put<Config>('/config', cfg))
      setMsg('Configurações salvas.')
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar')
    }
  }

  async function diagnosticar() {
    setDiagnosticando(true); setDiag(null)
    try {
      setDiag(await api.get<Diagnostico>('/diagnostico'))
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro no diagnóstico')
    } finally {
      setDiagnosticando(false)
    }
  }

  if (!cfg) return <Shell titulo="Configurações" voltarPara="/"><p className="text-slate-500">{erro || 'Carregando…'}</p></Shell>

  const campo = (label: string, ajuda: string, input: JSX.Element) => (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <p className="text-xs text-slate-500 mb-1">{ajuda}</p>
      {input}
    </div>
  )

  // IDs de loja: os configurados + os vistos nas NFs ("Loja 123")
  const idsLoja = new Set<string>(Object.keys(cfg.nomesCanais))
  for (const c of canaisVistos) { const m = c.canal.match(/^Loja (\d+)$/); if (m) idsLoja.add(m[1]) }
  const setNomeCanal = (id: string, nome: string) => setCfg({ ...cfg, nomesCanais: { ...cfg.nomesCanais, [id]: nome } })

  return (
    <Shell titulo="Configurações" voltarPara="/" largura="max-w-2xl">
      <form onSubmit={salvar} className="card p-4 space-y-5">
        {campo('Limite de bipe unitário', 'Até esta quantidade o operador bipa unidade a unidade. Acima, bipa 1 vez e digita a quantidade (item fica marcado para conferir peso).',
          <input className="input" type="number" min={1} max={1000} value={cfg.limiteBipeUnitario}
            onChange={e => setCfg({ ...cfg, limiteBipeUnitario: Number(e.target.value) })} />)}

        {campo('Intervalo de sincronização (min)', 'De quantos em quantos minutos buscar NFs novas no Bling.',
          <input className="input" type="number" min={1} max={120} value={cfg.intervaloSyncMin}
            onChange={e => setCfg({ ...cfg, intervaloSyncMin: Number(e.target.value) })} />)}

        {campo('Dias de NFs na fila', 'Quantos dias para trás buscar NFs (1 = só hoje).',
          <input className="input" type="number" min={1} max={30} value={cfg.diasNfsFila}
            onChange={e => setCfg({ ...cfg, diasNfsFila: Number(e.target.value) })} />)}

        <div className="border-t pt-4">
          <div className="font-semibold mb-1">Nomes dos canais de venda</div>
          <p className="text-xs text-slate-500 mb-2">A NF traz só o ID da loja do Bling. Dê um nome para aparecer na fila (ex.: Site, Mercado Livre, Balcão). Os IDs abaixo foram vistos nas NFs dos últimos 30 dias.</p>
          {idsLoja.size === 0 && <div className="text-sm text-slate-400">Nenhum ID de loja visto ainda.</div>}
          <div className="space-y-2">
            {[...idsLoja].map(id => {
              const qtd = canaisVistos.find(c => c.canal === `Loja ${id}`)?.quantidade
              return (
                <div key={id} className="flex items-center gap-2">
                  <span className="font-mono text-sm w-32 shrink-0">{id}</span>
                  <input className="input !py-1.5 !text-base" placeholder="Nome do canal" value={cfg.nomesCanais[id] ?? ''} onChange={e => setNomeCanal(id, e.target.value)} />
                  {qtd !== undefined && <span className="text-xs text-slate-400 whitespace-nowrap">{qtd} NF(s)</span>}
                </div>
              )
            })}
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="font-semibold mb-2">Balança (balcão)</div>
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={cfg.balancaAtiva} onChange={e => setCfg({ ...cfg, balancaAtiva: e.target.checked })} />
            Ativar conferência de peso no balcão
          </label>
          {campo('Tolerância de peso (%)', 'Diferença aceita entre o peso lido e o peso cadastrado × quantidade.',
            <input className="input" type="number" min={0} max={100} step={0.5} value={cfg.toleranciaPesoPct}
              onChange={e => setCfg({ ...cfg, toleranciaPesoPct: Number(e.target.value) })} />)}
        </div>

        {erro && <div className="rounded-xl bg-red-50 text-red-700 px-4 py-2 text-sm">{erro}</div>}
        {msg && <div className="rounded-xl bg-green-50 text-green-700 px-4 py-2 text-sm">{msg}</div>}
        <button className="btn-primary w-full">Salvar</button>
      </form>

      <div className="card p-4 mt-4">
        <div className="font-semibold mb-1">Etiquetas de prateleira</div>
        <p className="text-xs text-slate-500 mb-2">
          O sistema guarda quais SKUs já tiveram etiqueta impressa, para não repetir. Enquanto vocês estão
          testando (sem colar as etiquetas), esse registro fica com marcas indevidas — zere aqui quando começarem a etiquetar de verdade.
        </p>
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <span className="text-slate-600">
            Registradas: {impressas === null ? '…' : impressas.length === 0 ? 'nenhuma' : impressas.map(i => `${i.companyKey}: ${i.total}`).join(' · ')}
          </span>
          <button className="btn-secondary !py-1.5 !px-3 text-sm ml-auto" onClick={limparEtiquetas}>Zerar registro de etiquetas impressas</button>
        </div>
      </div>

      <div className="card p-4 mt-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="font-semibold flex-1">Diagnóstico do Bling</div>
          <button className="btn-secondary !py-1.5 !px-3 text-sm" onClick={diagnosticar} disabled={diagnosticando}>{diagnosticando ? 'Testando…' : 'Testar permissões'}</button>
        </div>
        <p className="text-xs text-slate-500 mb-3">Verifica o que o app do Bling deixa este módulo ler em cada empresa. Se "Produtos" estiver negado, a separação funciona só com os itens da NF (sem kits, fotos e catálogo de etiquetas) — adicione o escopo "Produtos" no app do Bling e reconecte a empresa no painel.</p>
        {diag && (
          <div className="space-y-3">
            {diag.mock && <div className="text-xs text-amber-700">Modo de dados de exemplo (SEPARACAO_MOCK) — diagnóstico simulado.</div>}
            {diag.empresas.map(e => (
              <div key={e.key}>
                <div className="font-medium text-sm mb-1">{e.empresa}</div>
                <ul className="text-sm space-y-0.5">
                  {e.recursos.map(r => (
                    <li key={r.recurso} className="flex gap-2">
                      <span className={r.ok ? 'text-green-700' : 'text-red-700'}>{r.ok ? '✔' : '✖'}</span>
                      <span className="w-36 shrink-0">{RECURSO_LABEL[r.recurso]?.nome ?? r.recurso}</span>
                      <span className="text-slate-500">{r.ok ? RECURSO_LABEL[r.recurso]?.usoNoApp : `${r.status ?? ''} ${r.detalhe ?? ''}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  )
}
