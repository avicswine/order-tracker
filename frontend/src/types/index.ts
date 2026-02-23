export type OrderStatus = 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED'

export interface Carrier {
  id: string
  name: string
  cnpj: string
  phone: string
  active: boolean
  createdAt: string
  updatedAt: string
  _count?: { orders: number }
}

export interface StatusHistory {
  id: string
  orderId: string
  status: OrderStatus
  note: string | null
  createdAt: string
}

export interface Order {
  id: string
  orderNumber: string
  customerName: string
  customerEmail: string | null
  carrierId: string
  carrier: Pick<Carrier, 'id' | 'name' | 'active'>
  status: OrderStatus
  shippedAt: string | null
  estimatedDelivery: string | null
  deliveredAt: string | null
  notes: string | null
  nfNumber: string | null
  senderCnpj: string | null
  createdAt: string
  updatedAt: string
  statusHistory?: StatusHistory[]
}

export interface OrdersResponse {
  data: Order[]
  meta: { total: number; page: number; limit: number; totalPages: number }
}

export interface OrderSummary {
  PENDING: number
  IN_TRANSIT: number
  DELIVERED: number
  CANCELLED: number
  TOTAL: number
}

export interface OrderFilters {
  status?: OrderStatus | ''
  startDate?: string
  endDate?: string
  search?: string
  nfNumber?: string
  senderCnpj?: string
  page?: number
}
