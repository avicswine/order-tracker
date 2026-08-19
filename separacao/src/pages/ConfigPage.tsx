import { useEffect, useState, type FormEvent } from 'react'
import Shell from '../components/Shell'
import { api } from '../lib/api'
import type { Config } from '../types'

export default function ConfigPage() {
  const [cfg, setCfg] = useState<Config | null>(null)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    api.get<Config>('/config').then(setCfg).catch(e => setErro(e.message))
  }, [])

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

  if (!cfg) return <Shell titulo="Configurações" voltarPara="/"><p className="text-slate-500">{erro || 'Carregando…'}</p></Shell>

  const campo = (label: string, ajuda: string, input: JSX.Element) => (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      <p className="text-xs text-slate-500 mb-1">{ajuda}</p>
      {input}
    </div>
  )

  return (
    <Shell titulo="Configurações" voltarPara="/">
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
    </Shell>
  )
}
