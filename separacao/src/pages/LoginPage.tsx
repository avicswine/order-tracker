import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'

const PIN_MIN = 4
const PIN_MAX = 8

export default function LoginPage() {
  const { login, setup } = useAuth()
  const navigate = useNavigate()

  const [precisaSetup, setPrecisaSetup] = useState<boolean | null>(null)
  const [nomes, setNomes] = useState<string[]>([])
  const [nome, setNome] = useState('')
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    api.get<{ precisaSetup: boolean }>('/auth/setup-status')
      .then(r => {
        setPrecisaSetup(r.precisaSetup)
        if (!r.precisaSetup) return api.get<string[]>('/auth/operadores-ativos').then(setNomes)
      })
      .catch(() => setErro('Não foi possível falar com o servidor.'))
  }, [])

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setErro('')
    if (!nome.trim()) return setErro('Informe o nome.')
    if (!/^\d{4,8}$/.test(pin)) return setErro(`PIN deve ter de ${PIN_MIN} a ${PIN_MAX} dígitos.`)

    setEnviando(true)
    try {
      if (precisaSetup) await setup(nome, pin)
      else await login(nome, pin)
      navigate('/', { replace: true })
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao entrar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-2xl font-bold text-center text-brand-900">Separação de Pedidos</h1>
        <p className="text-center text-slate-500 mt-1 mb-6">
          {precisaSetup === null && 'Conectando…'}
          {precisaSetup === true && 'Primeiro acesso: crie o supervisor inicial'}
          {precisaSetup === false && 'Entre com seu nome e PIN'}
        </p>

        <form onSubmit={enviar} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Nome</label>
            {nomes.length > 0 && !precisaSetup ? (
              <select className="input" value={nome} onChange={e => setNome(e.target.value)} autoFocus>
                <option value="">Selecione…</option>
                {nomes.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            ) : (
              <input
                className="input"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Seu nome"
                autoComplete="username"
                autoFocus
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">PIN</label>
            <input
              className="input tracking-[0.5em] text-center"
              type="password"
              inputMode="numeric"
              pattern="\d*"
              maxLength={PIN_MAX}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              autoComplete="current-password"
            />
          </div>

          {erro && <div className="rounded-xl bg-red-50 text-red-700 px-4 py-3 text-sm">{erro}</div>}

          <button type="submit" className="btn-primary w-full text-lg" disabled={enviando || precisaSetup === null}>
            {enviando ? 'Entrando…' : precisaSetup ? 'Criar supervisor e entrar' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
