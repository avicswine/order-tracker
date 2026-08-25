import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pendenciasApi, mlApi } from '../lib/api'
import { Modal } from '../components/ui/Modal'
import { Spinner } from '../components/ui/Spinner'
import { useAuth } from '../contexts/AuthContext'
import type { Pendencia, PendenciaStatus, PendenciaTipo, PendenciaLookupOrder } from '../types'

const EMPRESA_LABEL: Record<string, string> = {
  '47715256000149': 'AVIC',
  '54695386000122': 'AGRO',
  '56633474000125': 'EQUI',
}

const TIPO_LABEL: Record<PendenciaTipo, string> = {
  ATRASO: 'Atraso',
  OCORRENCIA: 'Ocorrência',
  DEFEITO: 'Defeito',
  ITEM_FALTANTE: 'Item faltante',
  DEVOLUCAO: 'Devolução',
  RECLAMACAO_ML: 'Reclamação ML',
  OUTRO: 'Outro',
}

const TIPO_BADGE: Record<PendenciaTipo, string> = {
  ATRASO: 'bg-amber-100 text-amber-700',
  OCORRENCIA: 'bg-red-100 text-red-700',
  DEFEITO: 'bg-purple-100 text-purple-700',
  ITEM_FALTANTE: 'bg-orange-100 text-orange-700',
  DEVOLUCAO: 'bg-blue-100 text-blue-700',
  RECLAMACAO_ML: 'bg-yellow-100 text-yellow-800',
  OUTRO: 'bg-gray-100 text-gray-600',
}

const ORIGEM_LABEL: Record<string, string> = {
  AUTO: '🤖 Automática',
  MANUAL: '✍️ Manual',
  MERCADO_LIVRE: '🛒 Mercado Livre',
}

const STATUS_TABS: { key: PendenciaStatus | 'TODAS'; label: string }[] = [
  { key: 'ABERTA', label: 'Abertas' },
  { key: 'EM_TRATAMENTO', label: 'Em tratamento' },
  { key: 'RESOLVIDA', label: 'Resolvidas' },
  { key: 'TODAS', label: 'Todas' },
]

const STATUS_LABEL: Record<PendenciaStatus, string> = {
  ABERTA: 'Aberta',
  EM_TRATAMENTO: 'Em tratamento',
  RESOLVIDA: 'Resolvida',
}

const STATUS_BADGE: Record<PendenciaStatus, string> = {
  ABERTA: 'bg-red-100 text-red-700',
  EM_TRATAMENTO: 'bg-blue-100 text-blue-700',
  RESOLVIDA: 'bg-green-100 text-green-700',
}

function fmtData(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

// Dias desde a criação; para resolvidas, quanto tempo levou até resolver
function diasEmAberto(p: Pendencia): number {
  const fim = p.status === 'RESOLVIDA' && p.resolvedAt ? new Date(p.resolvedAt).getTime() : Date.now()
  return Math.max(0, Math.floor((fim - new Date(p.createdAt).getTime()) / 86400000))
}

const DIAS_ALERTA = 3   // a partir daqui fica âmbar
const DIAS_CRITICO = 7  // a partir daqui fica vermelho

function DiasBadge({ p }: { p: Pendencia }) {
  const dias = diasEmAberto(p)
  if (p.status === 'RESOLVIDA') {
    return <span className="text-xs text-gray-400">{dias}d</span>
  }
  const cor = dias >= DIAS_CRITICO ? 'text-red-600 font-bold' : dias >= DIAS_ALERTA ? 'text-amber-600 font-semibold' : 'text-gray-500'
  return <span className={`text-sm ${cor}`}>{dias === 0 ? 'hoje' : `${dias}d`}</span>
}

export function PendenciasPage() {
  const { user } = useAuth()
  const canWrite = user?.role === 'ADMIN'
  const qc = useQueryClient()

  const [tab, setTab] = useState<PendenciaStatus | 'TODAS'>('ABERTA')
  const [tipoFiltro, setTipoFiltro] = useState('')
  const [origemFiltro, setOrigemFiltro] = useState('')
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [detalhe, setDetalhe] = useState<Pendencia | null>(null)

  const { data: pendencias, isLoading } = useQuery({
    queryKey: ['pendencias', tab, tipoFiltro, origemFiltro, search],
    queryFn: () =>
      pendenciasApi.list({
        ...(tab !== 'TODAS' && { status: tab }),
        ...(tipoFiltro && { tipo: tipoFiltro as PendenciaTipo }),
        ...(origemFiltro && { origem: origemFiltro }),
        ...(search && { search }),
      }),
  })

  // Contagem para os chips das abas (busca sem filtro de status)
  const { data: todas } = useQuery({
    queryKey: ['pendencias', 'contagem'],
    queryFn: () => pendenciasApi.list(),
    refetchInterval: 60000,
  })
  const contagem = (s: PendenciaStatus | 'TODAS') =>
    s === 'TODAS' ? (todas?.length ?? 0) : (todas?.filter((p) => p.status === s).length ?? 0)

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PendenciaStatus }) => pendenciasApi.update(id, { status }),
    onSuccess: (atualizada) => {
      qc.invalidateQueries({ queryKey: ['pendencias'] })
      setDetalhe((d) => (d && d.id === atualizada.id ? { ...d, status: atualizada.status } : d))
    },
  })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pós-vendas</h1>
          <p className="text-sm text-gray-500 mt-0.5">Pendências de vendas: atrasos, extravios, defeitos e reclamações</p>
        </div>
        {canWrite && (
          <button className="btn-primary" onClick={() => setFormOpen(true)}>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nova Pendência
          </button>
        )}
      </div>

      <MlBanner canWrite={canWrite} pos="topo" />

      {/* Abas de status */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-blue-100' : 'text-gray-400'}`}>{contagem(t.key)}</span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <select className="input !w-auto text-sm" value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
            <option value="">Todos os tipos</option>
            {Object.entries(TIPO_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <select className="input !w-auto text-sm" value={origemFiltro} onChange={(e) => setOrigemFiltro(e.target.value)}>
            <option value="">Todas as origens</option>
            <option value="AUTO">🤖 Automática</option>
            <option value="MANUAL">✍️ Manual</option>
            <option value="MERCADO_LIVRE">🛒 Mercado Livre</option>
          </select>
          <input
            className="input !w-52 text-sm"
            placeholder="Buscar NF ou cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Tabela */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Spinner className="h-8 w-8" /></div>
        ) : !pendencias || pendencias.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <svg className="h-12 w-12 mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-medium">Nenhuma pendência {tab === 'ABERTA' ? 'aberta' : ''} 🎉</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">NF</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Cliente</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Empresa</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Tipo</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Origem</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Criada</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Dias</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Notas</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendencias.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setDetalhe(p)}>
                    <td className="px-4 py-3 font-medium text-gray-900">{p.nfNumber ?? (p.mlOrderId ? `ML ${p.mlOrderId}` : '—')}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-[220px] truncate">{p.customerName}</td>
                    <td className="px-4 py-3 text-gray-500">{p.senderCnpj ? (EMPRESA_LABEL[p.senderCnpj] ?? '—') : '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TIPO_BADGE[p.tipo]}`}>
                        {TIPO_LABEL[p.tipo]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{ORIGEM_LABEL[p.origem]}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_BADGE[p.status]}`}>
                        {STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtData(p.createdAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap"><DiasBadge p={p} /></td>
                    <td className="px-4 py-3 text-gray-500 max-w-[260px]">
                      {p.notas.length > 0 ? (
                        <div
                          className="truncate text-xs"
                          title={p.notas.map((n) => `${fmtData(n.createdAt)} — ${n.texto}`).join('\n')}
                        >
                          💬{p.notas.length > 1 ? ` (${p.notas.length})` : ''} {p.notas[0].texto}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {canWrite && p.status !== 'RESOLVIDA' && (
                        <button
                          className="rounded-lg bg-green-50 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-100"
                          onClick={() => statusMutation.mutate({ id: p.id, status: 'RESOLVIDA' })}
                        >
                          Resolver
                        </button>
                      )}
                      {p.status === 'RESOLVIDA' && (
                        <span className="text-xs text-green-600 font-medium">✓ {p.resolvedAt ? fmtData(p.resolvedAt) : ''}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <MlBanner canWrite={canWrite} pos="rodape" />

      <NovaPendenciaModal open={formOpen} onClose={() => setFormOpen(false)} />
      {detalhe && (
        <DetalheModal
          pendencia={detalhe}
          canWrite={canWrite}
          onClose={() => setDetalhe(null)}
          onStatus={(status) => statusMutation.mutate({ id: detalhe.id, status })}
        />
      )}
    </div>
  )
}

// --- Integração ML ---
// pos="topo": banner amarelo, só aparece enquanto há empresa por conectar (chamada pra ação)
// pos="rodape": linha discreta no fim da página quando está tudo conectado
function MlBanner({ canWrite, pos }: { canWrite: boolean; pos: 'topo' | 'rodape' }) {
  const qc = useQueryClient()
  const { data: status } = useQuery({ queryKey: ['ml-status'], queryFn: mlApi.status, staleTime: 60000 })
  const syncMutation = useMutation({
    mutationFn: mlApi.sync,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['pendencias'] })
      alert(r.criadas > 0 ? `${r.criadas} reclamação(ões) importada(s) do ML` : 'Nenhuma reclamação nova no ML')
    },
  })

  if (!status) return null
  const naoAutorizadas = Object.entries(status).filter(([, s]) => s.configurado && !s.autorizado)
  const autorizadas = Object.entries(status).filter(([, s]) => s.autorizado)
  const pendenteConexao = naoAutorizadas.length > 0 || (autorizadas.length === 0 && naoAutorizadas.length === 0)

  async function conectar(company: string) {
    const url = await mlApi.authUrl(company)
    window.open(url, '_blank')
  }

  // Topo: só enquanto precisa de ação (conectar empresa ou configurar credenciais)
  if (pos === 'topo') {
    if (!pendenteConexao) return null
    return (
      <div className="flex items-center gap-3 flex-wrap rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-2.5 text-sm">
        <span className="font-medium text-yellow-800">🛒 Mercado Livre:</span>
        {canWrite && naoAutorizadas.map(([c]) => (
          <button key={c} className="rounded-lg bg-yellow-400 px-3 py-1 text-xs font-semibold text-yellow-900 hover:bg-yellow-500" onClick={() => conectar(c)}>
            Conectar {c.toUpperCase()}
          </button>
        ))}
        {autorizadas.length === 0 && naoAutorizadas.length === 0 && (
          <span className="text-yellow-700">credenciais não configuradas no servidor</span>
        )}
      </div>
    )
  }

  // Rodapé: discreto, quando está tudo conectado
  if (pendenteConexao) return null
  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span>🛒 Mercado Livre:</span>
      {autorizadas.map(([c]) => (
        <span key={c}>{c.toUpperCase()} ✓</span>
      ))}
      {canWrite && (
        <button
          className="ml-1 underline hover:text-gray-600"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          {syncMutation.isPending ? 'sincronizando...' : 'buscar reclamações'}
        </button>
      )}
    </div>
  )
}

// --- Modal de criação ---
function NovaPendenciaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [nf, setNf] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [lookupResult, setLookupResult] = useState<PendenciaLookupOrder[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [pedido, setPedido] = useState<PendenciaLookupOrder | null>(null)
  const [cliente, setCliente] = useState('')
  const [tipo, setTipo] = useState<PendenciaTipo>('DEFEITO')
  const [descricao, setDescricao] = useState('')

  function reset() {
    setNf(''); setEmpresa(''); setLookupResult(null); setPedido(null); setCliente(''); setTipo('DEFEITO'); setDescricao('')
  }

  async function buscarNf() {
    if (!nf.trim()) return
    setBuscando(true)
    setLookupResult(null)
    try {
      const results = await pendenciasApi.lookupNf(nf.trim(), empresa || undefined)
      setLookupResult(results)
      if (results.length === 1) selecionarPedido(results[0])
    } finally {
      setBuscando(false)
    }
  }

  function selecionarPedido(o: PendenciaLookupOrder) {
    setPedido(o)
    setCliente(o.customerName)
    setLookupResult(null)
  }

  const createMutation = useMutation({
    mutationFn: () =>
      pendenciasApi.create({
        customerName: cliente,
        tipo,
        nfNumber: pedido?.nfNumber ?? (nf.trim() || undefined),
        orderId: pedido?.id ?? undefined,
        senderCnpj: pedido?.senderCnpj ?? undefined,
        descricao: descricao.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pendencias'] })
      reset()
      onClose()
    },
  })

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title="Nova Pendência">
      <div className="space-y-4">
        {/* NF com busca automática */}
        <div>
          <label className="label">Número da NF (busca os dados automaticamente)</label>
          <div className="flex gap-2">
            <select className="input w-28" value={empresa} onChange={(e) => { setEmpresa(e.target.value); setPedido(null) }}>
              <option value="">Todas</option>
              <option value="avic">AVIC</option>
              <option value="agrogranja">AGRO</option>
              <option value="equipage">EQUI</option>
            </select>
            <input
              className="input flex-1"
              placeholder="Ex: 11536"
              value={nf}
              onChange={(e) => { setNf(e.target.value); setPedido(null) }}
              onKeyDown={(e) => e.key === 'Enter' && buscarNf()}
            />
            <button type="button" className="btn-secondary" onClick={buscarNf} disabled={buscando}>
              {buscando ? <Spinner className="h-4 w-4" /> : 'Buscar'}
            </button>
          </div>
          {buscando && (
            <p className="mt-1 text-xs text-gray-400">Buscando no painel e no Bling — pode levar alguns segundos...</p>
          )}
          {lookupResult && lookupResult.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              NF não encontrada no painel nem no Bling (últimos 6 meses){empresa ? '' : ' — tente selecionar a empresa'}. Preencha o cliente manualmente.
            </p>
          )}
          {lookupResult && lookupResult.length > 1 && (
            <div className="mt-2 space-y-1">
              {lookupResult.map((o) => (
                <button
                  key={o.id ?? o.orderNumber}
                  type="button"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:bg-blue-50"
                  onClick={() => selecionarPedido(o)}
                >
                  <span className="font-medium">{o.orderNumber}</span> — {o.customerName}
                </button>
              ))}
            </div>
          )}
          {pedido && (
            <div className="mt-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800">
              ✓ <b>{pedido.orderNumber}</b> — {pedido.customerName}
              {pedido.carrier && <> · {pedido.carrier.name}</>}
              {pedido.fonte === 'bling' && <> · <span className="text-blue-500">via Bling (sem rastreio no painel)</span></>}
              {pedido.lastTracking && <div className="mt-1 text-blue-600 truncate">Rastreio: {pedido.lastTracking}</div>}
            </div>
          )}
        </div>

        <div>
          <label className="label">Cliente *</label>
          <input className="input" placeholder="Nome do cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </div>

        <div>
          <label className="label">Tipo *</label>
          <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value as PendenciaTipo)}>
            {Object.entries(TIPO_LABEL).filter(([k]) => k !== 'RECLAMACAO_ML').map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Descrição do problema</label>
          <textarea
            className="input min-h-[70px]"
            placeholder="Ex: motor do ventilador não liga"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </div>

        {createMutation.isError && <p className="text-sm text-red-600">Erro ao salvar. Verifique os campos.</p>}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={() => { reset(); onClose() }}>Cancelar</button>
          <button
            type="button"
            className="btn-primary"
            disabled={!cliente.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Criar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// --- Modal de detalhe com histórico de anotações ---
function DetalheModal({ pendencia, canWrite, onClose, onStatus }: {
  pendencia: Pendencia
  canWrite: boolean
  onClose: () => void
  onStatus: (s: PendenciaStatus) => void
}) {
  const qc = useQueryClient()
  const [novaNota, setNovaNota] = useState('')
  const [notas, setNotas] = useState(pendencia.notas)

  const notaMutation = useMutation({
    mutationFn: () => pendenciasApi.addNota(pendencia.id, novaNota.trim()),
    onSuccess: (nota) => {
      setNotas((n) => [nota, ...n])
      setNovaNota('')
      qc.invalidateQueries({ queryKey: ['pendencias'] })
    },
  })

  return (
    <Modal open onClose={onClose} title={`${TIPO_LABEL[pendencia.tipo]} — ${pendencia.nfNumber ? `NF ${pendencia.nfNumber}` : pendencia.customerName}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-gray-500">Cliente:</span> <span className="font-medium">{pendencia.customerName}</span></div>
          <div><span className="text-gray-500">Empresa:</span> {pendencia.senderCnpj ? (EMPRESA_LABEL[pendencia.senderCnpj] ?? '—') : '—'}</div>
          <div><span className="text-gray-500">Origem:</span> {ORIGEM_LABEL[pendencia.origem]}</div>
          <div><span className="text-gray-500">Criada em:</span> {fmtData(pendencia.createdAt)}</div>
          {pendencia.order?.carrier && (
            <div className="col-span-2"><span className="text-gray-500">Transportadora:</span> {pendencia.order.carrier.name}</div>
          )}
          {pendencia.order?.lastTracking && (
            <div className="col-span-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              <b>Rastreio:</b> {pendencia.order.lastTracking}
            </div>
          )}
          {pendencia.descricao && (
            <div className="col-span-2 whitespace-pre-wrap rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
              {pendencia.descricao}
            </div>
          )}
          {pendencia.mlClaimId && (
            <div className="col-span-2 text-xs text-gray-500">Reclamação ML #{pendencia.mlClaimId}{pendencia.mlOrderId ? ` · Venda ${pendencia.mlOrderId}` : ''}</div>
          )}
        </div>

        {/* Status */}
        {canWrite && (
          <div className="flex gap-2">
            {(['ABERTA', 'EM_TRATAMENTO', 'RESOLVIDA'] as PendenciaStatus[]).map((s) => (
              <button
                key={s}
                className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  pendencia.status === s
                    ? s === 'RESOLVIDA' ? 'bg-green-600 text-white' : s === 'EM_TRATAMENTO' ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                onClick={() => onStatus(s)}
              >
                {s === 'ABERTA' ? 'Aberta' : s === 'EM_TRATAMENTO' ? 'Em tratamento' : 'Resolvida'}
              </button>
            ))}
          </div>
        )}

        {/* Anotações */}
        <div>
          <p className="label mb-2">Histórico de anotações</p>
          {canWrite && (
            <div className="flex gap-2 mb-3">
              <input
                className="input flex-1 text-sm"
                placeholder="Nova anotação... (Enter para salvar)"
                value={novaNota}
                onChange={(e) => setNovaNota(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && novaNota.trim() && notaMutation.mutate()}
              />
              <button className="btn-secondary" disabled={!novaNota.trim() || notaMutation.isPending} onClick={() => notaMutation.mutate()}>
                {notaMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Salvar'}
              </button>
            </div>
          )}
          {notas.length === 0 ? (
            <p className="text-xs text-gray-400">Nenhuma anotação ainda.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {notas.map((n) => (
                <div key={n.id} className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{n.texto}</p>
                  <p className="mt-1 text-xs text-gray-400">
                    {new Date(n.createdAt).toLocaleString('pt-BR')}{n.autor ? ` · ${n.autor}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
