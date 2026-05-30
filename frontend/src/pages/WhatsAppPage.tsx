import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'

type WppStatus = 'iniciando' | 'qr' | 'conectando' | 'pronto' | 'desconectado'

interface WppInstanceStatus {
  status: WppStatus
  qr: string | null
  numero: string | null
}

type WppStatusResponse = Record<'avic' | 'agro', WppInstanceStatus>

const COMPANY_LABELS: Record<string, string> = {
  avic: 'AVIC',
  agro: 'Agrogranja',
}

const STATUS_CONFIG: Record<WppStatus, { label: string; color: string; dot: string }> = {
  iniciando:    { label: 'Iniciando…',    color: 'text-gray-500',  dot: 'bg-gray-400' },
  qr:           { label: 'Aguardando QR', color: 'text-amber-600', dot: 'bg-amber-400 animate-pulse' },
  conectando:   { label: 'Conectando…',   color: 'text-blue-600',  dot: 'bg-blue-400 animate-pulse' },
  pronto:       { label: 'Conectado',     color: 'text-green-600', dot: 'bg-green-500' },
  desconectado: { label: 'Desconectado',  color: 'text-red-500',   dot: 'bg-red-400' },
}

function WppCard({ company, data }: { company: 'avic' | 'agro'; data: WppInstanceStatus }) {
  const qc = useQueryClient()
  const cfg = STATUS_CONFIG[data.status]

  const restart = useMutation({
    mutationFn: () => api.post(`/whatsapp/reiniciar/${company}`),
    onSuccess: () => { setTimeout(() => qc.invalidateQueries({ queryKey: ['whatsapp-status'] }), 2000) },
  })
  const logout = useMutation({
    mutationFn: () => api.post(`/whatsapp/deslogar/${company}`),
    onSuccess: () => { setTimeout(() => qc.invalidateQueries({ queryKey: ['whatsapp-status'] }), 2000) },
  })

  return (
    <div className="card p-6 space-y-5">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">{COMPANY_LABELS[company]}</h2>
          {data.numero && (
            <p className="text-sm text-gray-500 mt-0.5 font-mono">{data.numero}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
          <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
        </div>
      </div>

      {/* QR Code */}
      {data.status === 'qr' && data.qr && (
        <div className="flex flex-col items-center gap-3 py-2">
          <p className="text-sm text-gray-600 text-center">
            Abra o WhatsApp no celular → <strong>Dispositivos conectados</strong> → <strong>Conectar dispositivo</strong> → escaneie o QR abaixo:
          </p>
          <img
            src={data.qr}
            alt="QR Code WhatsApp"
            className="w-52 h-52 border-2 border-gray-200 rounded-lg"
          />
        </div>
      )}

      {/* Estado vazio */}
      {(data.status === 'iniciando' || data.status === 'conectando') && (
        <div className="text-center py-4">
          <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500 mt-2">
            {data.status === 'iniciando' ? 'Iniciando cliente WhatsApp…' : 'Autenticando com o WhatsApp…'}
          </p>
        </div>
      )}

      {data.status === 'desconectado' && !data.qr && (
        <p className="text-sm text-gray-500 text-center py-2">
          Desconectado. Clique em <strong>Reiniciar</strong> para gerar um novo QR.
        </p>
      )}

      {/* Botões */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={() => restart.mutate()}
          disabled={restart.isPending}
          className="btn-secondary flex-1 text-sm"
        >
          {restart.isPending ? 'Reiniciando…' : '🔄 Reiniciar'}
        </button>
        <button
          onClick={() => logout.mutate()}
          disabled={logout.isPending || data.status === 'desconectado'}
          className="btn-secondary flex-1 text-sm text-red-600 hover:text-red-700 disabled:opacity-40"
        >
          {logout.isPending ? 'Deslogando…' : '🚪 Deslogar'}
        </button>
      </div>
    </div>
  )
}

export function WhatsAppPage() {
  const [autoRefresh, setAutoRefresh] = useState(true)

  const { data, isLoading } = useQuery<WppStatusResponse>({
    queryKey: ['whatsapp-status'],
    queryFn: () => api.get('/whatsapp/status').then((r: { data: WppStatusResponse }) => r.data),
    refetchInterval: autoRefresh ? 5000 : false,
  })

  const needsAction = data && (
    data.avic.status === 'qr' ||
    data.agro.status === 'qr' ||
    data.avic.status === 'desconectado' ||
    data.agro.status === 'desconectado'
  )

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">WhatsApp</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gerencie as instâncias de envio de notificações</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-600">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            className="rounded border-gray-300"
          />
          Atualizar automaticamente
        </label>
      </div>

      {needsAction && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm">
          ⚠️ Uma ou mais instâncias precisam de atenção — escaneie o QR ou reinicie.
        </div>
      )}

      {isLoading ? (
        <div className="text-center text-gray-400 py-12">Carregando…</div>
      ) : data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <WppCard company="avic" data={data.avic} />
          <WppCard company="agro" data={data.agro} />
        </div>
      ) : null}

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">Como funciona</h3>
        <ul className="text-sm text-gray-600 space-y-1.5 list-disc list-inside">
          <li>Notificações são enviadas automaticamente a cada atualização de rastreio</li>
          <li><strong>AVIC</strong> envia via instância AVIC · <strong>Agrogranja</strong> envia via instância AGRO</li>
          <li>Se o número não for celular válido, o envio é feito por <strong>e-mail</strong></li>
          <li>Se não houver nem celular nem e-mail, a notificação é ignorada</li>
          <li>Primeira notificação do dia: saudação completa · Mesma dia: mensagem curta</li>
        </ul>
      </div>
    </div>
  )
}
