export type UserRole = 'ADMIN' | 'VIEWER'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
}

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
  whatsappResponsavel: string | null
  createdAt: string
  updatedAt: string
  _count?: { orders: number }
}

// Pós-vendas
export type PendenciaTipo = 'ATRASO' | 'OCORRENCIA' | 'DEFEITO' | 'ITEM_FALTANTE' | 'DEVOLUCAO' | 'RECLAMACAO_ML' | 'OUTRO'
export type PendenciaOrigem = 'AUTO' | 'MANUAL' | 'MERCADO_LIVRE'
export type PendenciaStatus = 'ABERTA' | 'EM_TRATAMENTO' | 'RESOLVIDA'

export interface PendenciaNota {
  id: string
  pendenciaId: string
  texto: string
  autor: string | null
  createdAt: string
}

export interface Pendencia {
  id: string
  orderId: string | null
  nfNumber: string | null
  customerName: string
  senderCnpj: string | null
  tipo: PendenciaTipo
  origem: PendenciaOrigem
  status: PendenciaStatus
  descricao: string | null
  mlClaimId: string | null
  mlOrderId: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
  order?: {
    id: string
    orderNumber: string
    status: OrderStatus
    lastTracking: string | null
    estimatedDelivery: string | null
    carrier: { name: string } | null
  } | null
  notas: PendenciaNota[]
}

export interface PendenciaLookupOrder {
  id: string
  orderNumber: string
  nfNumber: string | null
  customerName: string
  senderCnpj: string | null
  status: OrderStatus
  lastTracking: string | null
  estimatedDelivery: string | null
  hasOccurrence: boolean
  carrier: { name: string } | null
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
  carrier: Pick<Carrier, 'id' | 'name' | 'active' | 'trackingSystem' | 'trackingIdentifier'> | null
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
  hasOccurrence: boolean
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

export interface DelayedOrderInfo {
  nfNumber: string | null
  customerName: string
  shippedAt: string | null
  deliveredAt: string | null
  estimatedDelivery: string | null
  daysDelayed: number
  senderCnpj: string | null
}

export interface CarrierRanking {
  carrierId: string
  carrierName: string
  trackingSystem: TrackingSystem
  trackingIdentifier: string | null
  total: number
  delivered: number
  cancelled: number
  delayed: number
  delayedOrders: DelayedOrderInfo[]
  inTransit: number
  pending: number
  deliveryRate: number
  delayRate: number
  totalNfValue: number
  avgDeliveryDays: number | null
  occurrences: number
  occurrenceRate: number
}

export interface OrderFilters {
  status?: OrderStatus | ''
  startDate?: string
  endDate?: string
  shippedStartDate?: string
  nfStartDate?: string
  search?: string
  nfNumber?: string
  senderCnpj?: string
  carrierId?: string
  delayed?: boolean
  hasOccurrence?: boolean
  page?: number
  sortBy?: 'shippedAt' | 'estimatedDelivery'
  sortOrder?: 'asc' | 'desc'
}
