import { NavLink, Outlet } from 'react-router-dom'
import Shell from '../../components/Shell'

const ABAS = [
  { to: '/balcao/triagem', label: 'Triagem' },
  { to: '/balcao/fila', label: 'Fila do dia' },
  { to: '/balcao/conferir', label: 'Conferir / Finalizar' },
]

// Telas do PC do balcão (supervisor): triagem das NFs, painel da fila e conferência final.
export default function BalcaoLayout() {
  return (
    <Shell titulo="Balcão" voltarPara="/" largura="max-w-6xl">
      <nav className="flex gap-2 mb-4 border-b border-slate-200">
        {ABAS.map(a => (
          <NavLink
            key={a.to}
            to={a.to}
            className={({ isActive }) => `px-4 py-2 -mb-px border-b-2 font-medium ${isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
          >
            {a.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </Shell>
  )
}
