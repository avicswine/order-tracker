import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { PrivateRoute } from './components/PrivateRoute'
import { Layout } from './components/layout/Layout'
import { LoginPage } from './pages/LoginPage'
import { OrdersPage } from './pages/OrdersPage'
import { CarriersPage } from './pages/CarriersPage'
import { RankingPage } from './pages/RankingPage'
import { WhatsAppPage } from './pages/WhatsAppPage'
import { LogsPage } from './pages/LogsPage'
import { PendenciasPage } from './pages/PendenciasPage'
import { DifalPage } from './pages/DifalPage'
import { EnviosMlPage } from './pages/EnviosMlPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <PrivateRoute>
                <Layout>
                  <Telas />
                </Layout>
              </PrivateRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

function Telas() {
  const { user } = useAuth()
  // Financeiro só vê o DIFAL: qualquer outro endereço volta para lá
  if (user?.role === 'FINANCEIRO') {
    return (
      <Routes>
        <Route path="/difal" element={<DifalPage />} />
        <Route path="*" element={<Navigate to="/difal" replace />} />
      </Routes>
    )
  }
  return (
                  <Routes>
                    <Route path="/" element={<OrdersPage />} />
                    <Route path="/pendencias" element={<PendenciasPage />} />
                    <Route path="/difal" element={<DifalPage />} />
                    <Route path="/envios-ml" element={<EnviosMlPage />} />
                    <Route path="/carriers" element={<CarriersPage />} />
                    <Route path="/ranking" element={<RankingPage />} />
                    <Route path="/whatsapp" element={<WhatsAppPage />} />
                    <Route path="/logs" element={<LogsPage />} />
                  </Routes>
  )
}
