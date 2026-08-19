import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../contexts/AuthContext'

// Cabeçalho fixo + área de conteúdo. Mobile-first; no PC fica centralizado.
export default function Shell({ titulo, children, largura = 'max-w-lg', voltarPara }: {
  titulo: string
  children: ReactNode
  largura?: string
  voltarPara?: string
}) {
  const { operador, logout } = useAuth()
  const { pathname } = useLocation()

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-20 bg-brand-900 text-white shadow">
        <div className={`mx-auto ${largura} px-4 h-14 flex items-center gap-3`}>
          {voltarPara !== undefined && pathname !== '/' && (
            <Link to={voltarPara} className="text-2xl leading-none px-1" aria-label="Voltar">‹</Link>
          )}
          <h1 className="font-semibold text-lg flex-1 truncate">{titulo}</h1>
          <span className="text-sm text-blue-200 truncate max-w-[8rem]">{operador?.nome}</span>
          <button onClick={logout} className="text-sm underline underline-offset-2 text-blue-100">Sair</button>
        </div>
      </header>
      <main className={`mx-auto ${largura} w-full flex-1 p-4`}>{children}</main>
    </div>
  )
}
