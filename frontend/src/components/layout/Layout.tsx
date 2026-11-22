import { useState, type ReactNode } from 'react'
import { Sidebar } from './Sidebar'

const SIDEBAR_KEY = 'order_tracker_sidebar_min'

export function Layout({ children }: { children: ReactNode }) {
  const [minimizado, setMinimizado] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1')
  // celular: menu aberto por cima da tela (no computador o menu fica sempre visível)
  const [menuAberto, setMenuAberto] = useState(false)

  function toggle() {
    setMinimizado((m) => {
      localStorage.setItem(SIDEBAR_KEY, m ? '0' : '1')
      return !m
    })
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* celular: barra no topo com o botão que abre o menu */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 bg-secundaria-escura px-4 text-white md:hidden">
        <button onClick={() => setMenuAberto(true)} className="btn-icone text-slate-300 hover:bg-white/10 hover:text-white" aria-label="Abrir menu">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="text-sm font-bold">OrderTracker</span>
      </header>
      {menuAberto && <div className="janela-fundo fixed z-30 md:hidden" onClick={() => setMenuAberto(false)} aria-hidden />}
      {/* no celular o menu aberto aparece sempre completo (com os nomes) */}
      <Sidebar
        minimizado={minimizado && !menuAberto}
        onToggle={toggle}
        abertoNoCelular={menuAberto}
        onNavegar={() => setMenuAberto(false)}
      />
      <main className={`min-h-screen min-w-0 flex-1 pt-14 transition-[margin] md:pt-0 ${minimizado ? 'md:ml-16' : 'md:ml-60'}`}>{children}</main>
    </div>
  )
}
