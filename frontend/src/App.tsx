import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { PrivateRoute } from './components/PrivateRoute'
import { Layout } from './components/layout/Layout'
import { LoginPage } from './pages/LoginPage'
import { OrdersPage } from './pages/OrdersPage'
import { CarriersPage } from './pages/CarriersPage'
import { RankingPage } from './pages/RankingPage'
import { WhatsAppPage } from './pages/WhatsAppPage'
import { LogsPage } from './pages/LogsPage'

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
                  <Routes>
                    <Route path="/" element={<OrdersPage />} />
                    <Route path="/carriers" element={<CarriersPage />} />
                    <Route path="/ranking" element={<RankingPage />} />
                    <Route path="/whatsapp" element={<WhatsAppPage />} />
                    <Route path="/logs" element={<LogsPage />} />
                  </Routes>
                </Layout>
              </PrivateRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
