import axios from 'axios'
import type { Carrier, Order, OrderFilters, OrdersResponse, OrderSummary, OrderStatus } from '../types'

const api = axios.create({ baseURL: '/api' })

// Carriers
export const carriersApi = {
  list: () => api.get<Carrier[]>('/carriers').then((r) => r.data),
  get: (id: string) => api.get<Carrier>(`/carriers/${id}`).then((r) => r.data),
  create: (data: Omit<Carrier, 'id' | 'createdAt' | 'updatedAt' | '_count'>) =>
    api.post<Carrier>('/carriers', data).then((r) => r.data),
  update: (id: string, data: Partial<Omit<Carrier, 'id' | 'createdAt' | 'updatedAt' | '_count'>>) =>
    api.put<Carrier>(`/carriers/${id}`, data).then((r) => r.data),
  delete: (id: string) => api.delete(`/carriers/${id}`),
}

// Orders
export const ordersApi = {
  list: (filters?: OrderFilters) =>
    api.get<OrdersResponse>('/orders', { params: filters }).then((r) => r.data),
  summary: () => api.get<OrderSummary>('/orders/summary').then((r) => r.data),
  get: (id: string) => api.get<Order>(`/orders/${id}`).then((r) => r.data),
  create: (data: Partial<Order>) => api.post<Order>('/orders', data).then((r) => r.data),
  update: (id: string, data: Partial<Order>) =>
    api.put<Order>(`/orders/${id}`, data).then((r) => r.data),
  updateStatus: (id: string, status: OrderStatus, note?: string) =>
    api.patch<Order>(`/orders/${id}/status`, { status, note }).then((r) => r.data),
  delete: (id: string) => api.delete(`/orders/${id}`),
}
