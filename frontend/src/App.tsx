import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { OrdersPage } from './pages/OrdersPage'
import { CarriersPage } from './pages/CarriersPage'

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<OrdersPage />} />
          <Route path="/carriers" element={<CarriersPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
