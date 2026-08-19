import { useEffect, useState, type FormEvent } from 'react'
import Shell from '../components/Shell'
import { api } from '../lib/api'
import type { Operador } from '../types'

export default function OperadoresPage() {
  const [lista, setLista] = useState<Operador[]>([])
  const [nome, setNome] = useState('')
  const [pin, setPin] = useState('')
  const [supervisor, setSupervisor] = useState(false)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = () => api.get<Operador[]>('/operadores').then(setLista).catch(e => setErro(e.message))
  useEffect(() => { carregar() }, [])

  async function criar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setSalvando(true)
    try {
      await api.post('/operadores', { nome, pin, supervisor })
      setNome(''); setPin(''); setSupervisor(false)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao criar')
    } finally {
      setSalvando(false)
    }
  }

  async function alterar(op: Operador, dados: Partial<{ ativo: boolean; supervisor: boolean; pin: string }>) {
    setErro('')
    try {
      await api.patch(`/operadores/${op.id}`, dados)
      await carregar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao alterar')
    }
  }

  function novoPin(op: Operador) {
    const valor = window.prompt(`Novo PIN para ${op.nome} (4 a 8 dígitos):`)
    if (valor === null) return
    if (!/^\d{4,8}$/.test(valor)) return setErro('PIN deve ter de 4 a 8 dígitos')
    alterar(op, { pin: valor })
  }

  return (
    <Shell titulo="Operadores" voltarPara="/">
      <form onSubmit={criar} className="card p-4 space-y-3 mb-4">
        <div className="font-semibold">Novo operador</div>
        <input className="input" placeholder="Nome" value={nome} onChange={e => setNome(e.target.value)} />
        <input
          className="input" placeholder="PIN (4 a 8 dígitos)" inputMode="numeric" maxLength={8}
          value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={supervisor} onChange={e => setSupervisor(e.target.checked)} />
          Supervisor (triagem, balcão, etiquetas, config)
        </label>
        {erro && <div className="rounded-xl bg-red-50 text-red-700 px-4 py-2 text-sm">{erro}</div>}
        <button className="btn-primary w-full" disabled={salvando}>Cadastrar</button>
      </form>

      <div className="space-y-2">
        {lista.map(op => (
          <div key={op.id} className={`card p-3 flex items-center gap-3 ${op.ativo ? '' : 'opacity-60'}`}>
            <div className="flex-1">
              <div className="font-medium">{op.nome} {op.supervisor && <span className="text-xs bg-brand-100 text-brand-700 rounded px-1.5 py-0.5 ml-1">supervisor</span>}</div>
              <div className="text-xs text-slate-500">{op.ativo ? 'ativo' : 'inativo'}</div>
            </div>
            <button className="btn-secondary !py-1.5 !px-3 text-sm" onClick={() => novoPin(op)}>PIN</button>
            <button className="btn-secondary !py-1.5 !px-3 text-sm" onClick={() => alterar(op, { supervisor: !op.supervisor })}>
              {op.supervisor ? 'Rebaixar' : 'Promover'}
            </button>
            <button className="btn-secondary !py-1.5 !px-3 text-sm" onClick={() => alterar(op, { ativo: !op.ativo })}>
              {op.ativo ? 'Desativar' : 'Ativar'}
            </button>
          </div>
        ))}
      </div>
    </Shell>
  )
}
