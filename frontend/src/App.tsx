import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { OrdersPage } from './pages/OrdersPage'
import { CarriersPage } from './pages/CarriersPage'
import { RankingPage } from './pages/RankingPage'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<OrdersPage />} />
          <Route path="/carriers" element={<CarriersPage />} />
          <Route path="/ranking" element={<RankingPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
