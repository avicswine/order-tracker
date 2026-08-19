import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Shell from '../components/Shell'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import type { Empresa } from '../types'

interface Atalho {
  to: string
  titulo: string
  descricao: string
  somenteSupervisor?: boolean
}

const ATALHOS: Atalho[] = [
  { to: '/separar', titulo: 'Separar', descricao: 'Fila de NFs para bipar no estoque (celular)' },
  { to: '/balcao', titulo: 'Balcão', descricao: 'Triagem de NFs, conferência e finalização (PC)', somenteSupervisor: true },
  { to: '/etiquetas', titulo: 'Etiquetas', descricao: 'Imprimir QR Code dos SKUs para as prateleiras', somenteSupervisor: true },
  { to: '/operadores', titulo: 'Operadores', descricao: 'Cadastrar operadores e PINs', somenteSupervisor: true },
  { to: '/config', titulo: 'Configurações', descricao: 'Limite de bipe, sincronização, balança', somenteSupervisor: true },
]

export default function HomePage() {
  const { operador } = useAuth()
  const [empresas, setEmpresas] = useState<Empresa[]>([])

  useEffect(() => {
    api.get<Empresa[]>('/empresas').then(setEmpresas).catch(() => setEmpresas([]))
  }, [])

  const visiveis = ATALHOS.filter(a => !a.somenteSupervisor || operador?.supervisor)

  return (
    <Shell titulo="Separação de Pedidos">
      <div className="space-y-3">
        {visiveis.map(a => (
          <Link key={a.to} to={a.to} className="card block p-4 hover:border-brand-500 active:bg-slate-50">
            <div className="text-lg font-semibold">{a.titulo}</div>
            <div className="text-sm text-slate-500">{a.descricao}</div>
          </Link>
        ))}
      </div>

      <div className="mt-8">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Conexão com o Bling</div>
        <div className="flex flex-wrap gap-2">
          {empresas.map(e => (
            <span
              key={e.key}
              className={`px-3 py-1 rounded-full text-sm ${e.connected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
            >
              {e.name}: {e.connected ? 'conectada' : 'desconectada'}
            </span>
          ))}
          {empresas.length === 0 && <span className="text-sm text-slate-400">—</span>}
        </div>
      </div>
    </Shell>
  )
}
