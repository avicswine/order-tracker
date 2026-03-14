import { useEffect, useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../../lib/api'

interface CompanyStatus {
  key: string
  name: string
  cnpj: string
  connected: boolean
  configured: boolean
}

interface SyncResult {
  totalCriados: number
  totalIgnorados: number
  results: Record<string, { criados: number; ignorados: number }>
}

interface EnrichResult {
  atualizados: number
  semDados: number
}

interface TrackingResult {
  atualizados: number
  erros: number
  total: number
}

const blingApi = {
  status: () => api.get<CompanyStatus[]>('/bling/status').then((r) => r.data),
  sync: (company?: string) => api.post<SyncResult>('/bling/sync', company ? { company } : {}).then((r) => r.data),
  enrich: () => api.post<EnrichResult>('/bling/enrich').then((r) => r.data),
  disconnect: (company: string) => api.post(`/bling/disconnect/${company}`).then((r) => r.data),
}

interface TrackingProgress {
  current: number
  total: number
  orderNumber: string
  carrier: string
  status: string | null
}

export function BlingSync() {
  const qc = useQueryClient()

  const { data: companies = [], refetch } = useQuery({
    queryKey: ['bling-status'],
    queryFn: blingApi.status,
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('bling') === 'connected') {
      refetch()
      window.history.replaceState({}, '', '/')
    }
  }, [refetch])

  const syncMutation = useMutation({
    mutationFn: (company?: string) => blingApi.sync(company),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['bling-status'] })
    },
  })

  const enrichMutation = useMutation({
    mutationFn: blingApi.enrich,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })

  const [trackingProgress, setTrackingProgress] = useState<TrackingProgress | null>(null)
  const [trackingResult, setTrackingResult] = useState<TrackingResult | null>(null)
  const [trackingRunning, setTrackingRunning] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  function startTrackingSync() {
    if (trackingRunning) return
    setTrackingRunning(true)
    setTrackingProgress(null)
    setTrackingResult(null)

    const token = localStorage.getItem('token')
    const es = new EventSource(`/api/tracking/sync-stream?token=${token}`)
    esRef.current = es

    es.addEventListener('progress', (e) => {
      setTrackingProgress(JSON.parse(e.data) as TrackingProgress)
    })
    es.addEventListener('done', (e) => {
      const result = JSON.parse(e.data) as TrackingResult
      setTrackingResult(result)
      setTrackingProgress(null)
      setTrackingRunning(false)
      qc.invalidateQueries({ queryKey: ['orders'] })
      es.close()
    })
    es.addEventListener('error', () => {
      setTrackingRunning(false)
      es.close()
    })
  }

  const disconnectMutation = useMutation({
    mutationFn: (company: string) => blingApi.disconnect(company),
    onSuccess: () => refetch(),
  })

  const connectedCount = companies.filter((c) => c.connected).length
  const anyConnected = connectedCount > 0

  return (
    <div className="flex items-center gap-3">
      {/* Modal de progresso de rastreamento */}
      {(trackingRunning || trackingResult) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 flex flex-col gap-4">
            <h3 className="text-base font-semibold text-gray-800">
              {trackingRunning ? 'Atualizando rastreamento...' : 'Rastreamento concluído'}
            </h3>

            {trackingProgress && (
              <>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round((trackingProgress.current / trackingProgress.total) * 100)}%` }}
                  />
                </div>
                <div className="text-sm text-gray-600 space-y-0.5">
                  <p className="font-medium">
                    {trackingProgress.current} / {trackingProgress.total}
                    <span className="text-gray-400 font-normal ml-2">
                      ({Math.round((trackingProgress.current / trackingProgress.total) * 100)}%)
                    </span>
                  </p>
                  <p className="text-xs text-gray-500 truncate">{trackingProgress.orderNumber}</p>
                  <p className="text-xs text-gray-400 truncate">{trackingProgress.carrier}</p>
                </div>
              </>
            )}

            {trackingResult && !trackingRunning && (
              <>
                <div className="text-sm text-gray-700 space-y-1">
                  <p><span className="font-medium text-green-600">{trackingResult.atualizados}</span> rastreados com sucesso</p>
                  {trackingResult.erros > 0 && (
                    <p><span className="font-medium text-red-500">{trackingResult.erros}</span> com erro</p>
                  )}
                  <p className="text-gray-400 text-xs">Total: {trackingResult.total} pedidos</p>
                </div>
                <button
                  className="btn-primary text-sm w-full"
                  onClick={() => setTrackingResult(null)}
                >
                  Fechar
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Resultado das outras operações */}
      {syncMutation.data && !enrichMutation.data && (
        <span className="text-xs text-gray-500">
          {syncMutation.data.totalCriados} importados, {syncMutation.data.totalIgnorados} ignorados
        </span>
      )}
      {enrichMutation.data && (
        <span className="text-xs text-gray-500">
          {enrichMutation.data.atualizados} transportadoras vinculadas
        </span>
      )}

      {/* Botões Bling (aparecem se ao menos 1 empresa conectada) */}
      {anyConnected && (
        <>
          <button
            className="btn-secondary text-sm"
            onClick={() => syncMutation.mutate(undefined)}
            disabled={syncMutation.isPending || enrichMutation.isPending}
          >
            {syncMutation.isPending ? 'Importando...' : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Importar do Bling ({connectedCount})
              </>
            )}
          </button>

          <button
            className="btn-secondary text-sm"
            onClick={() => enrichMutation.mutate()}
            disabled={syncMutation.isPending || enrichMutation.isPending || trackingRunning}
            title="Busca transportadoras no Bling para pedidos que ainda não têm"
          >
            {enrichMutation.isPending ? 'Buscando...' : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Vincular transportadoras
              </>
            )}
          </button>

          <button
            className="btn-secondary text-sm"
            onClick={startTrackingSync}
            disabled={syncMutation.isPending || enrichMutation.isPending || trackingRunning}
            title="Consulta status de entrega nas transportadoras"
          >
            {trackingRunning ? 'Rastreando...' : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                </svg>
                Atualizar rastreamento
              </>
            )}
          </button>
        </>
      )}

      {/* Status por empresa */}
      <div className="flex items-center gap-2">
        {companies.map((company) => (
          <div key={company.key} className="relative group">
            {company.connected ? (
              <div className="flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-1">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-xs font-medium text-green-700">{company.name}</span>
                <button
                  onClick={() => syncMutation.mutate(company.key)}
                  disabled={syncMutation.isPending}
                  className="ml-1 text-green-400 hover:text-blue-500 leading-none"
                  title={`Importar só ${company.name}`}
                >
                  ↓
                </button>
                <button
                  onClick={() => disconnectMutation.mutate(company.key)}
                  className="text-green-400 hover:text-red-500 leading-none"
                  title="Desconectar"
                >
                  ×
                </button>
              </div>
            ) : company.configured ? (
              <a
                href={`/api/bling/auth/${company.key}`}
                className="flex items-center gap-1 rounded-full bg-gray-100 border border-gray-200 px-2 py-1 hover:bg-blue-50 hover:border-blue-200 transition-colors"
                title={`Conectar ${company.name}`}
              >
                <span className="h-2 w-2 rounded-full bg-gray-300" />
                <span className="text-xs text-gray-500">{company.name}</span>
              </a>
            ) : (
              <div
                className="flex items-center gap-1 rounded-full bg-gray-50 border border-dashed border-gray-200 px-2 py-1"
                title="Credenciais não configuradas"
              >
                <span className="h-2 w-2 rounded-full bg-gray-200" />
                <span className="text-xs text-gray-400">{company.name}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
