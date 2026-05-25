import { useEffect, useRef, useState } from 'react'
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

interface BlingProgress {
  company: string
  criados: number
  ignorados: number
  currentNf?: string
}

const blingApi = {
  status: () => api.get<CompanyStatus[]>('/bling/status').then((r) => r.data),
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

  // --- Bling sync via SSE ---
  const [blingRunning, setBlingRunning] = useState(false)
  const [blingProgress, setBlingProgress] = useState<BlingProgress | null>(null)
  const [blingResult, setBlingResult] = useState<SyncResult | null>(null)
  const [blingError, setBlingError] = useState<string | null>(null)
  const blingEsRef = useRef<EventSource | null>(null)

  function startBlingSync(company?: string) {
    if (blingRunning) return
    setBlingRunning(true)
    setBlingProgress(null)
    setBlingResult(null)
    setBlingError(null)

    const token = localStorage.getItem('order_tracker_token')
    const qs = new URLSearchParams({ token: token ?? '' })
    if (company) qs.set('company', company)
    const es = new EventSource(`/api/bling/sync-stream?${qs.toString()}`)
    blingEsRef.current = es

    es.addEventListener('progress', (e) => {
      setBlingProgress(JSON.parse(e.data) as BlingProgress)
    })
    es.addEventListener('done', (e) => {
      const result = JSON.parse(e.data) as SyncResult
      setBlingResult(result)
      setBlingRunning(false)
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['bling-status'] })
      es.close()
    })
    es.addEventListener('error', (e) => {
      const msg = (e as MessageEvent).data
        ? JSON.parse((e as MessageEvent).data).message
        : 'Falha na conexão com o servidor'
      setBlingError(msg)
      setBlingRunning(false)
      es.close()
    })
  }

  function closeBlingModal() {
    setBlingResult(null)
    setBlingError(null)
    setBlingProgress(null)
  }

  // --- Enrich ---
  const enrichMutation = useMutation({
    mutationFn: blingApi.enrich,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })

  // --- Tracking SSE ---
  const [trackingProgress, setTrackingProgress] = useState<TrackingProgress | null>(null)
  const [trackingResult, setTrackingResult] = useState<TrackingResult | null>(null)
  const [trackingRunning, setTrackingRunning] = useState(false)
  const [trackingError, setTrackingError] = useState<string | null>(null)
  const [trackingErrorOrders, setTrackingErrorOrders] = useState<{ orderNumber: string; carrier: string }[]>([])
  const [copied, setCopied] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  function openSseStream(url: string, accumulated: TrackingResult | null, onDone: (r: TrackingResult) => void) {
    const token = localStorage.getItem('order_tracker_token')
    const es = new EventSource(`${url}?token=${token}`)
    esRef.current = es

    es.addEventListener('progress', (e) => {
      const progress = JSON.parse(e.data) as TrackingProgress
      setTrackingProgress(progress)
      if (progress.status === 'erro') {
        setTrackingErrorOrders((prev) => [...prev, { orderNumber: progress.orderNumber, carrier: progress.carrier }])
      }
    })
    es.addEventListener('done', (e) => {
      const result = JSON.parse(e.data) as TrackingResult
      const merged: TrackingResult = {
        atualizados: (accumulated?.atualizados ?? 0) + result.atualizados,
        erros: (accumulated?.erros ?? 0) + result.erros,
        total: (accumulated?.total ?? 0) + result.total,
      }
      es.close()
      onDone(merged)
    })
    es.addEventListener('error', (e) => {
      const msg = (e as MessageEvent).data ? JSON.parse((e as MessageEvent).data).message : 'Falha na conexão com o servidor'
      setTrackingError(msg)
      setTrackingRunning(false)
      es.close()
    })
  }

  function startTrackingSync() {
    if (trackingRunning) return
    setTrackingRunning(true)
    setTrackingProgress(null)
    setTrackingResult(null)
    setTrackingError(null)
    setTrackingErrorOrders([])
    setCopied(false)

    openSseStream('/api/tracking/sync-stream', null, (result1) => {
      setTrackingProgress(null)
      openSseStream('/api/tracking/sync-stream-sm', result1, (result2) => {
        setTrackingResult(result2)
        setTrackingProgress(null)
        setTrackingRunning(false)
        qc.invalidateQueries({ queryKey: ['orders'] })
      })
    })
  }

  function closeTrackingModal() {
    setTrackingResult(null)
    setTrackingError(null)
    setTrackingProgress(null)
    setTrackingErrorOrders([])
    setCopied(false)
  }

  function copyErrors() {
    const byCompany: Record<string, string[]> = {}
    for (const o of trackingErrorOrders) {
      const empresa = o.orderNumber.split('-')[0]
      if (!byCompany[empresa]) byCompany[empresa] = []
      byCompany[empresa].push(o.orderNumber)
    }
    const text = Object.entries(byCompany)
      .map(([empresa, nfs]) => `${empresa}:\n${nfs.join('\n')}`)
      .join('\n\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const disconnectMutation = useMutation({
    mutationFn: (company: string) => blingApi.disconnect(company),
    onSuccess: () => refetch(),
  })

  const connectedCount = companies.filter((c) => c.connected).length
  const anyConnected = connectedCount > 0
  const anyBusy = blingRunning || enrichMutation.isPending || trackingRunning

  return (
    <div className="flex items-center gap-3">
      {/* Modal: importação Bling */}
      {(blingRunning || blingResult || blingError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800">
                {blingRunning ? 'Importando do Bling...' : blingError ? 'Erro na importação' : 'Importação concluída'}
              </h3>
              <button
                onClick={() => { blingEsRef.current?.close(); setBlingRunning(false); closeBlingModal() }}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                title="Fechar"
              >
                ×
              </button>
            </div>

            {blingRunning && !blingProgress && (
              <p className="text-sm text-gray-500">Conectando ao Bling...</p>
            )}

            {blingProgress && (
              <div className="text-sm text-gray-600 space-y-1">
                <p className="font-medium text-gray-700">{blingProgress.company}</p>
                <p>
                  <span className="font-medium text-green-600">{blingProgress.criados}</span>
                  <span className="text-gray-400"> importados · </span>
                  <span className="text-gray-500">{blingProgress.ignorados}</span>
                  <span className="text-gray-400"> ignorados</span>
                </p>
                {blingProgress.currentNf && (
                  <p className="text-xs text-gray-400">NF {blingProgress.currentNf}</p>
                )}
              </div>
            )}

            {blingError && (
              <>
                <p className="text-sm text-red-600">{blingError}</p>
                <button className="btn-primary text-sm w-full" onClick={closeBlingModal}>Fechar</button>
              </>
            )}

            {blingResult && !blingRunning && (
              <>
                <div className="text-sm text-gray-700 space-y-1">
                  {blingResult.totalCriados > 0 ? (
                    <p><span className="font-medium text-green-600">{blingResult.totalCriados}</span> novos pedidos importados</p>
                  ) : (
                    <p className="text-gray-500">Nenhum pedido novo encontrado</p>
                  )}
                  <p className="text-gray-400 text-xs">{blingResult.totalIgnorados} já existiam (ignorados)</p>
                </div>
                <button className="btn-primary text-sm w-full" onClick={closeBlingModal}>Fechar</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal: rastreamento */}
      {(trackingRunning || trackingResult || trackingError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-80 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-800">
                {trackingRunning ? 'Atualizando rastreamento...' : trackingError ? 'Erro no rastreamento' : 'Rastreamento concluído'}
              </h3>
              <button
                onClick={() => { esRef.current?.close(); setTrackingRunning(false); closeTrackingModal() }}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                title="Cancelar"
              >
                ×
              </button>
            </div>

            {trackingRunning && !trackingProgress && (
              <p className="text-sm text-gray-500">Conectando...</p>
            )}

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

            {trackingError && (
              <>
                <p className="text-sm text-red-600">{trackingError}</p>
                <button className="btn-primary text-sm w-full" onClick={closeTrackingModal}>Fechar</button>
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

                {trackingErrorOrders.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-red-600">NFs com erro</span>
                      <button
                        onClick={copyErrors}
                        className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                      >
                        {copied ? '✓ Copiado' : '📋 Copiar'}
                      </button>
                    </div>
                    <div className="max-h-40 overflow-y-auto rounded-lg bg-gray-50 border border-gray-100 p-2 space-y-0.5">
                      {Object.entries(
                        trackingErrorOrders.reduce<Record<string, string[]>>((acc, o) => {
                          const empresa = o.orderNumber.split('-')[0]
                          if (!acc[empresa]) acc[empresa] = []
                          acc[empresa].push(o.orderNumber)
                          return acc
                        }, {})
                      ).map(([empresa, nfs]) => (
                        <div key={empresa}>
                          <p className="text-xs font-semibold text-gray-500 mt-1">{empresa}</p>
                          {nfs.map((nf) => (
                            <p key={nf} className="text-xs text-red-500 pl-2">{nf}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button className="btn-primary text-sm w-full" onClick={closeTrackingModal}>Fechar</button>
              </>
            )}
          </div>
        </div>
      )}

      {enrichMutation.data && (
        <span className="text-xs text-gray-500">
          {enrichMutation.data.atualizados} transportadoras vinculadas
        </span>
      )}

      {anyConnected && (
        <>
          <button
            className="btn-secondary text-sm"
            onClick={() => startBlingSync()}
            disabled={anyBusy}
          >
            {blingRunning ? 'Importando...' : (
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
            disabled={anyBusy}
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
            disabled={anyBusy}
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
                  onClick={() => startBlingSync(company.key)}
                  disabled={anyBusy}
                  className="ml-1 text-green-400 hover:text-blue-500 leading-none disabled:opacity-40"
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
