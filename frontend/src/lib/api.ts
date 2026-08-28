import axios from 'axios'
import type { Carrier, CarrierRanking, Order, OrderFilters, OrdersResponse, OrderSummary, OrderStatus, Pendencia, PendenciaLookupOrder, PendenciaNota, PendenciaStatus, PendenciaTipo } from '../types'

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
  summary: (params?: { shippedStartDate?: string; nfStartDate?: string }) => api.get<OrderSummary>('/orders/summary', { params }).then((r) => r.data),
  get: (id: string) => api.get<Order>(`/orders/${id}`).then((r) => r.data),
  create: (data: Partial<Order>) => api.post<Order>('/orders', data).then((r) => r.data),
  update: (id: string, data: Partial<Order>) =>
    api.put<Order>(`/orders/${id}`, data).then((r) => r.data),
  updateStatus: (id: string, status: OrderStatus, note?: string) =>
    api.patch<Order>(`/orders/${id}/status`, { status, note }).then((r) => r.data),
  delete: (id: string) => api.delete(`/orders/${id}`),
}

// Pós-vendas
export const pendenciasApi = {
  list: (params?: { status?: string; tipo?: PendenciaTipo; empresa?: string; origem?: string; search?: string }) =>
    api.get<Pendencia[]>('/pendencias', { params }).then((r) => r.data),
  lookupNf: (nf: string, company?: string) =>
    api.get<PendenciaLookupOrder[]>(`/pendencias/lookup-nf/${encodeURIComponent(nf)}`, { params: { company } }).then((r) => r.data),
  create: (data: { customerName: string; tipo: PendenciaTipo; nfNumber?: string; orderId?: string; senderCnpj?: string; descricao?: string; responsavel?: string }) =>
    api.post<Pendencia>('/pendencias', data).then((r) => r.data),
  update: (id: string, data: { status?: PendenciaStatus; tipo?: PendenciaTipo; descricao?: string; responsavel?: string | null }) =>
    api.patch<Pendencia>(`/pendencias/${id}`, data).then((r) => r.data),
  bulk: (data: { ids: string[]; status?: PendenciaStatus; responsavel?: string; nota?: string }) =>
    api.patch<{ atualizadas: number }>('/pendencias/bulk', data).then((r) => r.data),
  danfe: (id: string) =>
    api.get<{ url: string }>(`/pendencias/${id}/danfe`).then((r) => r.data),
  addNota: (id: string, texto: string) =>
    api.post<PendenciaNota>(`/pendencias/${id}/notas`, { texto }).then((r) => r.data),
  delete: (id: string) => api.delete(`/pendencias/${id}`),
}

// Mercado Livre
export const mlApi = {
  status: () =>
    api.get<Record<string, { configurado: boolean; autorizado: boolean; userId: string | null }>>('/ml/status').then((r) => r.data),
  authUrl: (company: string) => api.get<{ url: string }>(`/ml/auth/${company}`).then((r) => r.data.url),
  sync: () => api.post<{ criadas: number; erros: string[] }>('/ml/sync').then((r) => r.data),
  mensagens: (pendenciaId: string) =>
    api.get<{ mensagens: { de: string; texto: string; data: string | null }[] }>(`/ml/pendencias/${pendenciaId}/mensagens`).then((r) => r.data.mensagens),
  mensagensNaoLidas: () =>
    api.get<{ conversas: MlConversa[]; erros: string[] }>('/ml/mensagens').then((r) => r.data),
}

export interface MlConversa {
  company: string
  packId: string
  comprador: string
  item: string
  naoLidas: number
  mensagens: { de: string; texto: string; data: string | null }[]
}
