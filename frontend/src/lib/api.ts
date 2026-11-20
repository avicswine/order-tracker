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
  varrerMensagens: (dias = 30) =>
    api.post<{ verificadas: number; pendentes: number; erros: string[] }>('/ml/mensagens/varrer', { dias }, { timeout: 300000 }).then((r) => r.data),
  responderPendencia: (pendenciaId: string, texto: string) =>
    api.post<{ ok: boolean }>(`/ml/pendencias/${pendenciaId}/responder`, { texto }).then((r) => r.data),
  responderConversa: (company: string, packId: string, texto: string) =>
    api.post<{ ok: boolean }>(`/ml/conversas/${company.toLowerCase()}/${packId}/responder`, { texto }).then((r) => r.data),
  // Mercado Envios 1 — avisos de envio ao ML
  enviosPendentes: () =>
    api.get<MlEnviosResponse>('/ml/envios/pendentes').then((r) => r.data),
  enviosSincronizar: (dryRun: boolean) =>
    api.post<MlEnviosCiclo>('/ml/envios/sincronizar', { dryRun }, { timeout: 600000 }).then((r) => r.data),
  enviosNotificar: (orderId: string, status: 'shipped' | 'delivered' | 'not_delivered') =>
    api.post<{ ok: boolean }>(`/ml/envios/${orderId}/notificar`, { status }, { timeout: 120000 }).then((r) => r.data),
}

export interface MlEnvio {
  id: string
  orderNumber: string
  nfNumber: string | null
  customerName: string
  status: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED'
  shippedAt: string | null
  deliveredAt: string | null
  lastTracking: string | null
  mlCompany: string | null
  mlOrderId: string | null
  mlShipmentId: string | null
  mlShippedNotifiedAt: string | null
  mlDeliveredNotifiedAt: string | null
  mlEnvioErro: string | null
  estimatedDelivery: string | null     // previsão da transportadora
  mlPromessaEntrega: string | null     // prazo prometido pelo ML ao comprador
  mlOutForDeliveryAt: string | null
}

export interface MlEnviosResponse {
  pendentes: MlEnvio[]
  config: { portalUrl: string; trackingMsg: string; trackingComentario: string; auto: boolean }
}

export interface MlEnviosCiclo {
  vinculados: number
  me1: number
  processados: number
  dryRun: boolean
  resultados: {
    orderNumber: string
    nfNumber: string | null
    mlShipmentId: string
    acao: 'shipped' | 'delivered' | 'shipped+delivered'
    ok: boolean
    erro?: string
  }[]
}

export interface MlConversa {
  company: string
  packId: string
  comprador: string
  item: string
  naoLidas: number
  mensagens: { de: string; texto: string; data: string | null }[]
}

// --- Monitor de DIFAL ---------------------------------------------------
// Quem recolhe o diferencial de alíquota de cada nota: o Mercado Livre (que
// depois cobra de nós), nós mesmos por guia, ou o próprio cliente quando ele é
// contribuinte com inscrição estadual.
export type DifalResponsavel = 'ML_PAGA' | 'NOSSO' | 'CLIENTE' | 'SEM_DIFAL'
export type DifalSituacao = 'PENDENTE' | 'CONFERIDO' | 'DIVERGENTE' | 'PAGO' | 'ATRASADO'

export interface DifalImportacaoStatus {
  emAndamento: boolean
  iniciadaEm: string | null
  terminadaEm: string | null
  resultado:
    | { empresa: string; lidas: number; gravadas: number; atualizadas: number; ignoradas: number; puladas: number; erros: string[] }[]
    | null
  erro: string | null
}

/** item da NF guardado na importação (tooltip no número da nota) */
export interface DifalItemNota {
  sku: string | null
  descricao: string | null
  ncm: string | null
  quantidade: number | null
  unidade: string | null
  valorUnitario: number | null
  valorTotal: number
}


export interface DifalResumo {
  porResponsavel: {
    responsavel: DifalResponsavel
    notas: number
    calculado: number
    cobradoMl: number
    pagoGuia: number
  }[]
  aPagar: { notas: number; valor: number }
  divergentes: { notas: number; valor: number }
}

export interface DifalAliquota {
  uf: string
  nome: string
  aliquotaInterna: number
  fcp: number
  interestadual: number
  metodo: string
  posicaoFisco: boolean
  nota: string | null
  codigoReceitaGnre: string | null
  vencimentoRegra: string
}

export interface DifalGuiaPendente {
  id: string
  empresa: string
  nfNumero: string
  clienteNome: string
  itens: DifalItemNota[] | null
  emitidaEm: string
  clienteUf: string
  difalCalculado: number
  pronta: boolean
  faltando: string[]
  /** último dia para pagar sem multa/juros (AAAA-MM-DD) */
  prazo: string
  /** passou do prazo: vai para a contabilidade, não para lote */
  atrasada: boolean
  /** envio no order-tracker; null = nota não está lá (retirada, Mercado Envios, Shopee…) */
  envio: {
    situacao: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED'
    transportadora: string | null
    enviadoEm: string | null
    previsao: string | null
    entregueEm: string | null
    ultimoRastreio: string | null
  } | null
  /** venda do ML: depois de pagar, anexar o comprovante na venda do ML */
  ml: boolean
  mlOrderId: string | null
  guiaGeradaEm: string | null
  /** guia processada pelo portal: libera 'Comprovante enviado' */
  guiaAceita: boolean
  situacao: string
  observacao: string | null
  /** estado em que já tivemos cobrança de DIFAL */
  estadoComCobranca: boolean
  /** a conta do DIFAL feita na importação (calculo.ts) */
  calculoDetalhe: DifalCalculoDetalhe | null
}

/** espelho do 'detalhe' montado em backend/src/services/difal/calculo.ts */
export interface DifalCalculoDetalhe {
  uf?: string
  aliquotaInterna?: number
  fcp?: number
  interestadual?: number
  freteRateado?: number
  motivo?: string
  erro?: string
  comReducao?: {
    valor: number
    difal: number
    metodo?: 'carga' | 'prop'
    explicacao?: string
    cargaTotal?: number
    cargaOrigem?: number
    cargaDevida?: number
    baseReduzida?: number
    diferencaAliquotas?: number
  }
  semReducao?: { valor: number; difal: number; aliquotaCheia: number }
}


export interface DifalHistorico {
  apuradoEm: string
  periodo: { de: string; ate: string }
  resumo: {
    notas: number
    guiasTotal: number
    pago: number
    devido: number
    aMais: number
    encargos: number
    autuacoes: { notas: number; valor: number }
    guiasComReducao: number
    guiasComparadas: number
  }
  estados: {
    uf: string
    estado: string
    notas: number
    base: number
    pago: number
    devido: number
    aMais: number
    pctCobrado: number
    pctDevido: number
    encargos: number
    metodo: string
  }[]
  meses: { mes: string; label: string; notas: number; pago: number; devido: number; aMais: number }[]
  notas: {
    nf: string
    uf: string
    estado: string
    data: string
    mes_label: string
    base: number
    icms_origem: number
    difal_pago: number
    difal_devido: number
    diferenca: number
    pct_pago: number
    pct_devido: number
    encargos: number
    guia: string
    autuacao: boolean
  }[]
}

export interface DifalFechamentoMes {
  mes: string
  empresa: string
  cobradoMl: number
  lancamentos: number
  calculado: number
  notas: number
  diferenca: number
}

export interface DifalSincronizacaoMl {
  empresa: string
  periodos: string[]
  lidos: number
  cdifal: number
  erro?: string
}

export interface DifalPortalStatus {
  ambiente: 'homologacao' | 'producao'
  host: string
  empresas: { AVIC: boolean; AGRO: boolean }
}

export interface DifalReceitaUf {
  codigo: string
  descricao: string
  courier: boolean
  exigeDetalhamentoReceita: boolean
  exigeProduto: boolean
  exigePeriodoReferencia: boolean
  exigeDocumentoOrigem: boolean
  exigeDataVencimento: boolean
  exigeContribuinteDestinatario: string
  exigeCamposAdicionais: boolean
  tiposDocumentosOrigem: { codigo: string; descricao: string }[]
  camposAdicionais: { codigo: string; titulo: string; obrigatorio: boolean; tipo: string }[]
}

export interface DifalConfigUf {
  uf: string
  situacao: { codigo: string; descricao: string }
  receitas: DifalReceitaUf[]
  limites: { guiasPorLote?: string; itensPorGuia?: string; itensPorLote?: string }
}

export interface DifalGuiaResultado {
  situacaoGuia: string
  situacaoTexto: string
  identificadorGuia?: string
  ufFavorecida?: string
  valorGNRE?: string
  linhaDigitavel?: string
  qrcodePayload?: string
  dataLimitePagamento?: string
  motivos: { codigo: string; descricao: string; campo?: string }[]
}

export interface DifalLote {
  id: string
  empresa: string
  ambiente: string
  guias: number
  total: number
  criadoEm: string
  enviadoEm: string | null
  numeroRecibo: string | null
  situacaoCodigo: string | null
  situacaoDescricao: string | null
  consultadoEm: string | null
  temPdf: boolean
  guiasResultado: DifalGuiaResultado[]
}

export const difalApi = {
  resumo: (params?: { desde?: string }) =>
    api.get<DifalResumo>('/difal/resumo', { params }).then((r) => r.data),
  aliquotas: () => api.get<DifalAliquota[]>('/difal/aliquotas').then((r) => r.data),
  historico: () => api.get<DifalHistorico>('/difal/historico').then((r) => r.data),
  importar: (dias?: number) =>
    api.post<{ ok: boolean; iniciada: boolean }>('/difal/importar', { dias }).then((r) => r.data),
  importarStatus: () => api.get<DifalImportacaoStatus>('/difal/importar/status').then((r) => r.data),
  atualizarAliquota: (uf: string, dados: { codigoReceitaGnre?: string; vencimentoRegra?: string; tipoDocOrigemGnre?: string; camposAdicionais?: DifalReceitaUf['camposAdicionais']; exigeProduto?: boolean }) =>
    api.put<DifalAliquota>(`/difal/aliquotas/${uf}`, dados).then((r) => r.data),
  portalStatus: () => api.get<DifalPortalStatus>('/difal/portal/status').then((r) => r.data),
  portalConfigUf: (uf: string, empresa: string) =>
    api.get<DifalConfigUf>(`/difal/portal/config/${uf}`, { params: { empresa } }).then((r) => r.data),
  lotes: () => api.get<DifalLote[]>('/difal/lotes').then((r) => r.data),
  enviarLote: (id: string) =>
    api.post<{ numeroRecibo: string | null; situacaoCodigo: string; situacaoDescricao: string }>(`/difal/lotes/${id}/enviar`).then((r) => r.data),
  consultarLote: (id: string) =>
    api.post<{ situacao: { codigo: string; descricao: string }; guias: DifalGuiaResultado[]; temPdf: boolean }>(`/difal/lotes/${id}/consultar`).then((r) => r.data),
  // downloads passam pelo axios para levar o token de login
  desfazerLote: (id: string) =>
    api.post<{ ok: boolean; notasDevolvidas: number }>(`/difal/lotes/${id}/desfazer`).then((r) => r.data),
  baixarXmlLote: (id: string) =>
    api.get<Blob>(`/difal/lotes/${id}/xml`, { responseType: 'blob' }).then((r) => ({ arquivo: r.data, nome: `gnre-lote-${id}.xml` })),
  baixarPdfLote: (id: string) =>
    api.get<Blob>(`/difal/lotes/${id}/pdf`, { responseType: 'blob' }).then((r) => ({ arquivo: r.data, nome: `gnre-guias-${id}.pdf` })),
  fechamentoMensal: () => api.get<DifalFechamentoMes[]>('/difal/fechamento-mensal').then((r) => r.data),
  sincronizarCobrancasMl: () =>
    api.post<DifalSincronizacaoMl[]>('/difal/cobrancas-ml/sincronizar', { meses: 2 }).then((r) => r.data),
  marcarComprovanteMl: (id: string) => api.post<{ ok: boolean }>(`/difal/notas/${id}/comprovante-ml`).then((r) => r.data),
  guiasPendentes: () => api.get<DifalGuiaPendente[]>('/difal/guias-pendentes').then((r) => r.data),
  // devolve o XML do lote GNRE como arquivo para baixar
  gerarLote: (ids: string[]) =>
    api.post<Blob>('/difal/guias/lote', { ids }, { responseType: 'blob' }).then((r) => ({
      arquivo: r.data,
      nome: /filename="([^"]+)"/.exec(r.headers['content-disposition'] ?? '')?.[1] ?? 'gnre-lote.xml',
      loteId: String(r.headers['x-lote-id'] ?? ''),
      guias: Number(r.headers['x-lote-guias'] ?? 0),
      total: Number(r.headers['x-lote-total'] ?? 0),
    })),
}
