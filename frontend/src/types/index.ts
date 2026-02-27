export type OrderStatus = 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED'
export type TrackingSystem = 'SSW' | 'SENIOR' | 'PUPPETEER' | 'SAO_MIGUEL' | 'ATUAL_CARGAS' | 'RODONAVES' | 'BRASPRESS' | 'NONE'

export interface Carrier {
  id: string
  name: string
  cnpj: string
  phone: string
  active: boolean
  trackingSystem: TrackingSystem
  trackingIdentifier: string | null
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

export interface TrackingEvent {
  date?: string | null
  description: string
}

export interface Order {
  id: string
  orderNumber: string
  customerName: string
  customerEmail: string | null
  customerPhone: string | null
  carrierId: string | null
  carrier: Pick<Carrier, 'id' | 'name' | 'active'> | null
  status: OrderStatus
  shippedAt: string | null
  estimatedDelivery: string | null
  deliveredAt: string | null
  notes: string | null
  nfNumber: string | null
  senderCnpj: string | null
  recipientCnpj: string | null
  lastTracking: string | null
  lastTrackingAt: string | null
  trackingEvents?: TrackingEvent[]
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
  DELAYED: number
  TOTAL: number
}

export interface CarrierRanking {
  carrierId: string
  carrierName: string
  trackingSystem: TrackingSystem
  total: number
  delivered: number
  cancelled: number
  delayed: number
  inTransit: number
  pending: number
  deliveryRate: number
  delayRate: number
  totalNfValue: number
  avgDeliveryDays: number | null
}

export interface OrderFilters {
  status?: OrderStatus | ''
  startDate?: string
  endDate?: string
  search?: string
  nfNumber?: string
  senderCnpj?: string
  carrierId?: string
  delayed?: boolean
  page?: number
  sortBy?: 'shippedAt' | 'estimatedDelivery'
  sortOrder?: 'asc' | 'desc'
}
