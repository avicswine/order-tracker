import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

const navItems = [
  {
    to: '/',
    label: 'Pedidos',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    to: '/pendencias',
    label: 'Pós-vendas',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  {
    to: '/envios-ml',
    label: 'Envios ML',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
      </svg>
    ),
  },
  {
    to: '/difal',
    label: 'DIFAL',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 7h6m-6 4h6m-6 4h4M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
      </svg>
    ),
  },
  {
    to: '/carriers',
    label: 'Transportadoras',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
      </svg>
    ),
  },
  {
    to: '/ranking',
    label: 'Ranking',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    to: '/logs',
    label: 'Logs',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    to: '/whatsapp',
    label: 'WhatsApp',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
]

interface SidebarProps {
  minimizado?: boolean
  onToggle?: () => void
  /** celular: o menu fica escondido e abre por cima da tela pelo botão ☰ */
  abertoNoCelular?: boolean
  onNavegar?: () => void
}

export function Sidebar({ minimizado = false, onToggle, abertoNoCelular = false, onNavegar }: SidebarProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col overflow-y-auto bg-secundaria-escura transition-[width,transform] md:visible md:translate-x-0 ${abertoNoCelular ? 'translate-x-0' : 'invisible -translate-x-full'} ${minimizado ? 'w-16' : 'w-60'}`}>
      {/* Logo */}
      <div className={`flex items-center gap-3 py-5 border-b border-white/10 ${minimizado ? 'px-3 justify-center' : 'px-6'}`}>
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primaria-600">
          <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        {!minimizado && (
          <div>
            <p className="text-sm font-bold text-white leading-tight">OrderTracker</p>
            <p className="text-xs text-slate-400">Rastreamento</p>
          </div>
        )}
      </div>

      {/* Botão minimizar/expandir */}
      {onToggle && (
        <button
          onClick={onToggle}
          title={minimizado ? 'Expandir menu' : 'Minimizar menu'}
          className={`mx-3 mt-2 hidden items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition hover:bg-white/10 hover:text-white md:flex ${minimizado ? 'justify-center' : ''}`}
        >
          <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {minimizado ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            )}
          </svg>
          {!minimizado && 'Minimizar'}
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            title={item.label}
            onClick={onNavegar}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${minimizado ? 'justify-center' : ''} ${
                isActive
                  ? 'bg-primaria-600 text-white'
                  : 'text-slate-400 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            {item.icon}
            {!minimizado && item.label}
          </NavLink>
        ))}
        <a
          href="/portal"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onNavegar}
          title="Portal Cliente"
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition text-slate-400 hover:bg-white/10 hover:text-white ${minimizado ? 'justify-center' : ''}`}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {!minimizado && 'Portal Cliente'}
        </a>
        {/* Separação (app do galpão) fora do menu enquanto não está em uso; o app continua em /separacao */}
        <a
          href="http://localhost:5175/"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onNavegar}
          title="Power BI"
          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition text-slate-400 hover:bg-white/10 hover:text-white ${minimizado ? 'justify-center' : ''}`}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          {!minimizado && 'Power BI'}
        </a>
      </nav>

      <div className={`py-4 border-t border-white/10 space-y-3 ${minimizado ? 'px-2' : 'px-4'}`}>
        {user && !minimizado && (
          <div className="px-2">
            <p className="text-xs font-medium text-white truncate">{user.name}</p>
            <p className="text-xs text-slate-500">{user.role === 'ADMIN' ? 'Administrador' : 'Visualizador'}</p>
          </div>
        )}
        <button
          onClick={handleLogout}
          title="Sair"
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:bg-white/10 hover:text-white transition ${minimizado ? 'justify-center' : ''}`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {!minimizado && 'Sair'}
        </button>
      </div>
    </aside>
  )
}
