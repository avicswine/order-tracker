import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'

const blingApi = {
  status: () => axios.get('/api/bling/status').then((r) => r.data),
  sync: () => axios.post('/api/bling/sync').then((r) => r.data),
  disconnect: () => axios.post('/api/bling/disconnect').then((r) => r.data),
}

export function BlingSync() {
  const qc = useQueryClient()
  const [syncResult, setSyncResult] = useState<{ criados: number; ignorados: number } | null>(null)

  const { data: status, refetch: refetchStatus } = useQuery({
    queryKey: ['bling-status'],
    queryFn: blingApi.status,
    refetchInterval: false,
  })

  // Detectar retorno do OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('bling') === 'connected') {
      refetchStatus()
      window.history.replaceState({}, '', '/')
    }
  }, [refetchStatus])

  const syncMutation = useMutation({
    mutationFn: blingApi.sync,
    onSuccess: (data) => {
      setSyncResult({ criados: data.criados, ignorados: data.ignorados })
      qc.invalidateQueries({ queryKey: ['orders'] })
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: blingApi.disconnect,
    onSuccess: () => {
      refetchStatus()
      setSyncResult(null)
    },
  })

  const connected = status?.connected

  return (
    <div className="flex items-center gap-3">
      {connected ? (
        <>
          {syncResult && (
            <span className="text-xs text-gray-500">
              {syncResult.criados} importados, {syncResult.ignorados} ignorados
            </span>
          )}
          <button
            className="btn-secondary text-sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? (
              'Importando...'
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Importar do Bling
              </>
            )}
          </button>
          <button
            className="text-xs text-gray-400 hover:text-red-500"
            onClick={() => disconnectMutation.mutate()}
            title="Desconectar Bling"
          >
            Desconectar
          </button>
        </>
      ) : (
        <a
          href="/api/bling/auth"
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          Conectar ao Bling
        </a>
      )}
    </div>
  )
}
