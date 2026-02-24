import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

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
  status: () => axios.get<CompanyStatus[]>('/api/bling/status').then((r) => r.data),
  sync: () => axios.post<SyncResult>('/api/bling/sync').then((r) => r.data),
  enrich: () => axios.post<EnrichResult>('/api/bling/enrich').then((r) => r.data),
  disconnect: (company: string) => axios.post(`/api/bling/disconnect/${company}`).then((r) => r.data),
}

const trackingApi = {
  sync: () => axios.post<TrackingResult>('/api/tracking/sync').then((r) => r.data),
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
    mutationFn: blingApi.sync,
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

  const trackingMutation = useMutation({
    mutationFn: trackingApi.sync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: (company: string) => blingApi.disconnect(company),
    onSuccess: () => refetch(),
  })

  const connectedCount = companies.filter((c) => c.connected).length
  const anyConnected = connectedCount > 0

  return (
    <div className="flex items-center gap-3">
      {/* Resultado da última operação */}
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
      {trackingMutation.data && (
        <span className="text-xs text-gray-500">
          {trackingMutation.data.atualizados}/{trackingMutation.data.total} rastreados
          {trackingMutation.data.erros > 0 && `, ${trackingMutation.data.erros} erro(s)`}
        </span>
      )}

      {/* Botões Bling (aparecem se ao menos 1 empresa conectada) */}
      {anyConnected && (
        <>
          <button
            className="btn-secondary text-sm"
            onClick={() => syncMutation.mutate()}
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
            disabled={syncMutation.isPending || enrichMutation.isPending || trackingMutation.isPending}
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
            onClick={() => trackingMutation.mutate()}
            disabled={syncMutation.isPending || enrichMutation.isPending || trackingMutation.isPending}
            title="Consulta status de entrega nas transportadoras"
          >
            {trackingMutation.isPending ? 'Rastreando...' : (
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
                  onClick={() => disconnectMutation.mutate(company.key)}
                  className="ml-1 text-green-400 hover:text-red-500 leading-none"
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
