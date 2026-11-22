import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../lib/api'
import { TOM, seloTom, type Tom } from '../lib/estilo'

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

const STATUS_CONFIG: Record<WppStatus, { label: string; tom: Tom; piscando?: boolean }> = {
  iniciando:    { label: 'Iniciando…',    tom: 'cinza' },
  qr:           { label: 'Aguardando QR', tom: 'ambar', piscando: true },
  conectando:   { label: 'Conectando…',   tom: 'azul', piscando: true },
  pronto:       { label: 'Conectado',     tom: 'verde' },
  desconectado: { label: 'Desconectado',  tom: 'vermelho' },
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
    <div className="card space-y-5 p-6">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{COMPANY_LABELS[company]}</h2>
          {data.numero && (
            <p className="text-sm text-slate-500 mt-0.5 font-mono">{data.numero}</p>
          )}
        </div>
        <div className={seloTom(cfg.tom)}>
          <span className={`selo-ponto ${TOM[cfg.tom].ponto} ${cfg.piscando ? 'animate-pulse' : ''}`} />
          {cfg.label}
        </div>
      </div>

      {/* QR Code */}
      {data.status === 'qr' && data.qr && (
        <div className="flex flex-col items-center gap-3 py-2">
          <p className="text-sm text-slate-600 text-center">
            Abra o WhatsApp no celular → <strong>Dispositivos conectados</strong> → <strong>Conectar dispositivo</strong> → escaneie o QR abaixo:
          </p>
          <img
            src={data.qr}
            alt="QR Code WhatsApp"
            className="w-52 h-52 border-2 border-slate-200 rounded-lg"
          />
        </div>
      )}

      {/* Estado vazio */}
      {(data.status === 'iniciando' || data.status === 'conectando') && (
        <div className="text-center py-4">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primaria-600 border-t-transparent" />
          <p className="text-sm text-slate-500 mt-2">
            {data.status === 'iniciando' ? 'Iniciando cliente WhatsApp…' : 'Autenticando com o WhatsApp…'}
          </p>
        </div>
      )}

      {data.status === 'desconectado' && !data.qr && (
        <p className="text-sm text-slate-500 text-center py-2">
          Desconectado. Clique em <strong>Reiniciar</strong> para gerar um novo QR.
        </p>
      )}

      {/* Botões */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={() => restart.mutate()}
          disabled={restart.isPending}
          className="btn-secondary flex-1"
        >
          {restart.isPending ? 'Reiniciando…' : '🔄 Reiniciar'}
        </button>
        <button
          onClick={() => logout.mutate()}
          disabled={logout.isPending || data.status === 'desconectado'}
          className="btn-secondary flex-1 text-red-700 hover:bg-red-50"
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
    <div className="pagina">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="pagina-titulo">WhatsApp</h1>
          <p className="pagina-subtitulo">Gerencie as instâncias de envio de notificações</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-slate-600">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            className="checkbox"
          />
          Atualizar automaticamente
        </label>
      </div>

      {needsAction && (
        <div className="alerta-aviso">
          ⚠️ Uma ou mais instâncias precisam de atenção — escaneie o QR ou reinicie.
        </div>
      )}

      {isLoading ? (
        <div className="estado-carregando">Carregando…</div>
      ) : data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <WppCard company="avic" data={data.avic} />
          <WppCard company="agro" data={data.agro} />
        </div>
      ) : null}

      <div className="card p-5 space-y-3">
        <h3 className="secao-titulo">Como funciona</h3>
        <ul className="text-sm text-slate-600 space-y-1.5 list-disc list-inside">
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
