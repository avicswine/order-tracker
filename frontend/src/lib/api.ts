import axios from 'axios'
import type { Carrier, CarrierRanking, Order, OrderFilters, OrdersResponse, OrderSummary, OrderStatus } from '../types'

const TOKEN_KEY = 'order_tracker_token'

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

// Carriers
export const carriersApi = {
  list: () => api.get<Carrier[]>('/carriers').then((r) => r.data),
  ranking: (params?: { startDate?: string; endDate?: string }) =>
    api.get<CarrierRanking[]>('/carriers/ranking', { params }).then((r) => r.data),
  get: (id: string) => api.get<Carrier>(`/carriers/${id}`).then((r) => r.data),
  create: (data: Omit<Carrier, 'id' | 'createdAt' | 'updatedAt' | '_count'>) =>
    api.post<Carrier>('/carriers', data).then((r) => r.data),
  update: (id: string, data: Partial<Omit<Carrier, 'id' | 'createdAt' | 'updatedAt' | '_count'>>) =>
    api.put<Carrier>(`/carriers/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/carriers/${id}`),
}

// Orders
export const ordersApi = {
  list: (filters?: OrderFilters) => {
    const params = filters
      ? Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false))
      : undefined
    return api.get<OrdersResponse>('/orders', { params }).then((r) => r.data)
  },
  summary: (params?: { shippedStartDate?: string }) => api.get<OrderSummary>('/orders/summary', { params }).then((r) => r.data),
  get: (id: string) => api.get<Order>(`/orders/${id}`).then((r) => r.data),
  create: (data: Partial<Order>) => api.post<Order>('/orders', data).then((r) => r.data),
  update: (id: string, data: Partial<Order>) =>
    api.put<Order>(`/orders/${id}`, data).then((r) => r.data),
  updateStatus: (id: string, status: OrderStatus, note?: string) =>
    api.patch<Order>(`/orders/${id}/status`, { status, note }).then((r) => r.data),
  delete: (id: string) => api.delete(`/orders/${id}`),
}
