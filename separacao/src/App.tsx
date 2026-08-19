import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import OperadoresPage from './pages/OperadoresPage'
import ConfigPage from './pages/ConfigPage'
import SepararFilaPage from './pages/SepararFilaPage'
import SepararTarefaPage from './pages/SepararTarefaPage'
import BalcaoLayout from './pages/balcao/BalcaoLayout'
import TriagemPage from './pages/balcao/TriagemPage'
import FilaPage from './pages/balcao/FilaPage'
import ConferirPage from './pages/balcao/ConferirPage'
import EtiquetasPage from './pages/EtiquetasPage'

function Protegida({ children, supervisor = false }: { children: ReactNode; supervisor?: boolean }) {
  const { operador, carregando } = useAuth()
  const location = useLocation()
  if (carregando) return <div className="p-6 text-center text-slate-500">Carregando…</div>
  if (!operador) return <Navigate to="/login" replace state={{ de: location.pathname }} />
  if (supervisor && !operador.supervisor) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter basename="/separacao">
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Protegida><HomePage /></Protegida>} />
          <Route path="/separar" element={<Protegida><SepararFilaPage /></Protegida>} />
          <Route path="/separar/:id" element={<Protegida><SepararTarefaPage /></Protegida>} />
          <Route path="/balcao" element={<Protegida supervisor><BalcaoLayout /></Protegida>}>
            <Route index element={<Navigate to="/balcao/triagem" replace />} />
            <Route path="triagem" element={<TriagemPage />} />
            <Route path="fila" element={<FilaPage />} />
            <Route path="conferir" element={<ConferirPage />} />
            <Route path="conferir/:id" element={<ConferirPage />} />
          </Route>
          <Route path="/etiquetas" element={<Protegida supervisor><EtiquetasPage /></Protegida>} />
          <Route path="/operadores" element={<Protegida supervisor><OperadoresPage /></Protegida>} />
          <Route path="/config" element={<Protegida supervisor><ConfigPage /></Protegida>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
