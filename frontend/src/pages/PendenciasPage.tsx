import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pendenciasApi, mlApi, type MlConversa } from '../lib/api'
import { Modal } from '../components/ui/Modal'
import { Spinner } from '../components/ui/Spinner'
import { useAuth } from '../contexts/AuthContext'
import type { Pendencia, PendenciaStatus, PendenciaTipo, PendenciaLookupOrder } from '../types'
import { formatDate, formatDateTime } from '../lib/utils'
import { TOM, seloTom, type Tom } from '../lib/estilo'

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

const TIPO_TOM: Record<PendenciaTipo, Tom> = {
  ATRASO: 'laranja',
  OCORRENCIA: 'vermelho',
  DEFEITO: 'primaria',
  ITEM_FALTANTE: 'ambar',
  DEVOLUCAO: 'azul',
  RECLAMACAO_ML: 'ambarForte',
  OUTRO: 'cinza',
}

const ORIGEM_LABEL: Record<string, string> = {
  AUTO: '🤖 Automática',
  MANUAL: '✍️ Manual',
  MERCADO_LIVRE: '🛒 Mercado Livre',
}

// Abreviações para a tabela (libera espaço para a coluna Notas)
const ORIGEM_ABREV: Record<string, string> = {
  AUTO: 'Aut',
  MANUAL: 'Man',
  MERCADO_LIVRE: 'ML',
}

const EMPRESA_COR: Record<string, string> = {
  AVIC: 'bg-black text-white',
  AGRO: 'bg-red-600 text-white',
  EQUI: 'bg-orange-500 text-white',
}

const RESPONSAVEIS = ['José', 'Micheli', 'Jeovan']

type TabKey = 'ATIVAS' | PendenciaStatus | 'TODAS'

const STATUS_TABS: { key: TabKey; label: string }[] = [
  { key: 'ATIVAS', label: 'Ativas' },
  { key: 'ABERTA', label: 'Abertas' },
  { key: 'EM_TRATAMENTO', label: 'Em tratamento' },
  { key: 'RESOLVIDA', label: 'Resolvidas' },
  { key: 'TODAS', label: 'Todas' },
]

// Filtro de status enviado à API por aba
const TAB_STATUS: Record<TabKey, string | undefined> = {
  ATIVAS: 'ABERTA,EM_TRATAMENTO',
  ABERTA: 'ABERTA',
  EM_TRATAMENTO: 'EM_TRATAMENTO',
  RESOLVIDA: 'RESOLVIDA',
  TODAS: undefined,
}

const STATUS_LABEL: Record<PendenciaStatus, string> = {
  ABERTA: 'Aberta',
  EM_TRATAMENTO: 'Em tratamento',
  RESOLVIDA: 'Resolvida',
}

const STATUS_TOM_PENDENCIA: Record<PendenciaStatus, Tom> = {
  ABERTA: 'vermelho',
  EM_TRATAMENTO: 'azul',
  RESOLVIDA: 'verde',
}


// Sigla da empresa a partir do CNPJ, aceitando formatado ou só dígitos
function empresaSigla(cnpj: string | null): string | null {
  if (!cnpj) return null
  return EMPRESA_LABEL[cnpj.replace(/\D/g, '')] ?? null
}

// Dias desde a criação; para resolvidas, quanto tempo levou até resolver
function diasEmAberto(p: Pendencia): number {
  const fim = p.status === 'RESOLVIDA' && p.resolvedAt ? new Date(p.resolvedAt).getTime() : Date.now()
  return Math.max(0, Math.floor((fim - new Date(p.createdAt).getTime()) / 86400000))
}

const DIAS_ALERTA = 3   // a partir daqui fica âmbar
const DIAS_CRITICO = 7  // a partir daqui fica vermelho

// Prazo máximo para responder ao Mercado Livre — cor por urgência
function PrazoMl({ p }: { p: Pendencia }) {
  if (!p.mlDueDate || p.status === 'RESOLVIDA') return null
  const prazo = new Date(p.mlDueDate)
  const horas = (prazo.getTime() - Date.now()) / 3600000
  const cor = horas <= 0 ? 'text-red-600 font-bold' : horas <= 24 ? 'text-red-600 font-semibold' : horas <= 48 ? 'text-amber-600 font-semibold' : 'text-slate-500'
  const texto = horas <= 0
    ? 'prazo ML vencido!'
    : `ML até ${formatDateTime(p.mlDueDate)}`
  return <div className={`text-xs leading-tight mt-0.5 whitespace-nowrap ${cor}`} title="Prazo máximo para responder ao Mercado Livre">⏳ {texto}</div>
}

function DiasBadge({ p }: { p: Pendencia }) {
  const dias = diasEmAberto(p)
  if (p.status === 'RESOLVIDA') {
    return <span className="text-xs text-slate-400">{dias}d</span>
  }
  const cor = dias >= DIAS_CRITICO ? 'text-red-600 font-bold' : dias >= DIAS_ALERTA ? 'text-amber-600 font-semibold' : 'text-slate-500'
  return <span className={`text-sm ${cor}`}>{dias === 0 ? 'hoje' : `${dias}d`}</span>
}

export function PendenciasPage() {
  const { user } = useAuth()
  const canWrite = user?.role === 'ADMIN'
  const qc = useQueryClient()

  const [tab, setTab] = useState<TabKey>('ATIVAS')
  const [tipoFiltro, setTipoFiltro] = useState('')
  const [origemFiltro, setOrigemFiltro] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [detalhe, setDetalhe] = useState<Pendencia | null>(null)
  const [selecionadas, setSelecionadas] = useState<string[]>([])
  const [resolver, setResolver] = useState<Pendencia | null>(null) // pendência aguardando texto de conclusão
  const [mensagensDe, setMensagensDe] = useState<Pendencia | null>(null) // pendência com thread ML aberta
  const [inboxAberto, setInboxAberto] = useState(false) // janela de mensagens pós-venda não lidas

  // Mensagens pós-venda não lidas no ML — atualiza sozinho a cada 5 min
  const { data: inbox } = useQuery({
    queryKey: ['ml-inbox'],
    queryFn: mlApi.mensagensNaoLidas,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  })
  const inboxTotal = inbox?.conversas.length ?? 0
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkResp, setBulkResp] = useState('')

  const { data: pendencias, isLoading } = useQuery({
    queryKey: ['pendencias', tab, tipoFiltro, origemFiltro, search],
    queryFn: () =>
      pendenciasApi.list({
        ...(TAB_STATUS[tab] && { status: TAB_STATUS[tab] }),
        ...(tipoFiltro && { tipo: tipoFiltro as PendenciaTipo }),
        ...(origemFiltro.length > 0 && { origem: origemFiltro.join(',') }),
        ...(search && { search }),
      }),
  })

  // Contagem para os chips das abas (busca sem filtro de status)
  const { data: todas } = useQuery({
    queryKey: ['pendencias', 'contagem'],
    queryFn: () => pendenciasApi.list(),
    refetchInterval: 60000,
  })
  const contagem = (s: TabKey) => {
    if (s === 'TODAS') return todas?.length ?? 0
    if (s === 'ATIVAS') return todas?.filter((p) => p.status !== 'RESOLVIDA').length ?? 0
    return todas?.filter((p) => p.status === s).length ?? 0
  }

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PendenciaStatus }) => pendenciasApi.update(id, { status }),
    onSuccess: (atualizada) => {
      qc.invalidateQueries({ queryKey: ['pendencias'] })
      setDetalhe((d) => (d && d.id === atualizada.id ? { ...d, status: atualizada.status } : d))
    },
  })

  // Troca de responsável sempre registra a alteração no histórico de anotações
  const respMutation = useMutation({
    mutationFn: async ({ pendencia, responsavel }: { pendencia: Pendencia; responsavel: string | null }) => {
      if ((pendencia.responsavel ?? null) !== responsavel) {
        await pendenciasApi.addNota(pendencia.id, `👤 Responsável: ${pendencia.responsavel ?? 'ninguém'} → ${responsavel ?? 'ninguém'}`)
      }
      return pendenciasApi.update(pendencia.id, { responsavel })
    },
    onSuccess: (atualizada) => {
      qc.invalidateQueries({ queryKey: ['pendencias'] })
      setDetalhe((d) => (d && d.id === atualizada.id ? { ...d, responsavel: atualizada.responsavel } : d))
    },
  })

  const bulkMutation = useMutation({
    mutationFn: (data: { ids: string[]; status?: PendenciaStatus; responsavel?: string; nota?: string }) => pendenciasApi.bulk(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pendencias'] })
      setSelecionadas([]); setBulkStatus(''); setBulkResp('')
    },
  })

  // Resolver com texto de conclusão (nota assinada + responsável + status)
  const resolverMutation = useMutation({
    mutationFn: async ({ pendencia, texto, quem }: { pendencia: Pendencia; texto: string; quem: string }) => {
      const nota = texto.trim() ? `✅ Conclusão (${quem}): ${texto.trim()}` : `✅ Concluída por ${quem}`
      await pendenciasApi.addNota(pendencia.id, nota)
      return pendenciasApi.update(pendencia.id, { status: 'RESOLVIDA', responsavel: quem })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pendencias'] })
      setResolver(null)
      setDetalhe(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => pendenciasApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pendencias'] })
      setSelecionadas((s) => s.filter((id) => (pendencias ?? []).some((p) => p.id === id)))
    },
  })

  function excluir(p: Pendencia) {
    if (confirm(`Excluir a pendência ${p.nfNumber ? `da NF ${p.nfNumber}` : `de ${p.customerName}`}? Essa ação não pode ser desfeita.`)) {
      deleteMutation.mutate(p.id)
    }
  }

  // Abrir DANFE da NF (painel ou Bling)
  async function abrirDanfe(p: Pendencia) {
    try {
      const { url } = await pendenciasApi.danfe(p.id)
      window.open(url, '_blank', 'noopener')
    } catch {
      alert('DANFE não disponível para esta NF.')
    }
  }

  const idsVisiveis = (pendencias ?? []).map((p) => p.id)
  const todasMarcadas = idsVisiveis.length > 0 && idsVisiveis.every((id) => selecionadas.includes(id))
  function toggleTodas() {
    setSelecionadas(todasMarcadas ? [] : idsVisiveis)
  }
  function toggleUma(id: string) {
    setSelecionadas((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  return (
    <div className="pagina">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="pagina-titulo">Pós-vendas</h1>
          <p className="pagina-subtitulo">Pendências de vendas: atrasos, extravios, defeitos e reclamações</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`relative ${inboxTotal > 0 ? 'btn border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100' : 'btn-secondary'}`}
            onClick={() => setInboxAberto(true)}
            title="Conversas do pós-venda do ML aguardando resposta"
          >
            💬 Mensagens ML
            {inboxTotal > 0 && (
              <span className="absolute -top-2 -right-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
                {inboxTotal}
              </span>
            )}
          </button>
          {canWrite && (
            <button className="btn-primary" onClick={() => setFormOpen(true)}>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nova Pendência
            </button>
          )}
        </div>
      </div>

      <MlBanner canWrite={canWrite} pos="topo" />

      {/* Abas de status */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200">
        <div className="abas border-b-0">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`aba ${tab === t.key ? 'aba-ativa' : ''}`}
            >
              {t.label}
              <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-primaria-600' : 'text-slate-400'}`}>{contagem(t.key)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <select className="input !w-auto text-sm" value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
            <option value="">Todos os tipos</option>
            {Object.entries(TIPO_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            {([['AUTO', '🤖 Auto'], ['MANUAL', '✍️ Manual'], ['MERCADO_LIVRE', '🛒 ML']] as const).map(([k, label]) => {
              const ativo = origemFiltro.includes(k)
              return (
                <button
                  key={k}
                  onClick={() => setOrigemFiltro((atual) => ativo ? atual.filter((o) => o !== k) : [...atual, k])}
                  className={`${ativo ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  title={ativo ? 'Clique para remover o filtro' : 'Clique para filtrar por esta origem'}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <input
            className="input !w-52 text-sm"
            placeholder="Buscar NF ou cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Barra de ações em massa */}
      {selecionadas.length > 0 && (
        <div className="alerta-info flex flex-wrap items-center gap-3 py-2.5">
          <span className="font-medium text-primaria-800">{selecionadas.length} selecionada{selecionadas.length > 1 ? 's' : ''}</span>
          <select className="input !w-auto text-sm" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)}>
            <option value="">Mudar status...</option>
            <option value="ABERTA">Aberta</option>
            <option value="EM_TRATAMENTO">Em tratamento</option>
            <option value="RESOLVIDA">Resolvida</option>
          </select>
          <select className="input !w-auto text-sm" value={bulkResp} onChange={(e) => setBulkResp(e.target.value)}>
            <option value="">Atribuir a...</option>
            {RESPONSAVEIS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            className="btn-primary btn-sm"
            disabled={(!bulkStatus && !bulkResp) || bulkMutation.isPending}
            onClick={() => bulkMutation.mutate({
              ids: selecionadas,
              ...(bulkStatus && { status: bulkStatus as PendenciaStatus }),
              ...(bulkResp && { responsavel: bulkResp, nota: `👤 Responsável definido em massa: ${bulkResp}` }),
            })}
          >
            {bulkMutation.isPending ? <Spinner className="h-4 w-4" /> : 'Aplicar'}
          </button>
          <button className="btn-ghost btn-sm" onClick={() => setSelecionadas([])}>Limpar seleção</button>
        </div>
      )}

      {/* Tabela */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="estado-carregando"><Spinner className="h-8 w-8" /></div>
        ) : !pendencias || pendencias.length === 0 ? (
          <div className="estado-vazio">
            <svg className="h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-medium text-slate-700">Nenhuma pendência {tab === 'ABERTA' ? 'aberta' : ''} 🎉</p>
          </div>
        ) : (
          <div className="tabela-caixa">
            <table className="tabela tabela-compacta">
              <thead>
                <tr>
                  {canWrite && (
                    <th className="w-8">
                      <input type="checkbox" className="checkbox" checked={todasMarcadas} onChange={toggleTodas} />
                    </th>
                  )}
                  <th>Empresa</th>
                  <th>NF</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th title="Origem">Orig.</th>
                  <th>Status</th>
                  <th title="Responsável">Resp.</th>
                  <th>Criada</th>
                  <th>Dias</th>
                  <th className="w-full">Notas</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {pendencias.map((p) => {
                  const empresa = empresaSigla(p.senderCnpj)
                  // Coluna Notas mostra só o andamento real — registros de troca de
                  // responsável (👤) ficam apenas no histórico do detalhe
                  const notasReais = p.notas.filter((n) => !n.texto.startsWith('👤'))
                  return (
                  <tr key={p.id} className="cursor-pointer" onClick={() => setDetalhe(p)}>
                    {canWrite && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="checkbox" checked={selecionadas.includes(p.id)} onChange={() => toggleUma(p.id)} />
                      </td>
                    )}
                    <td>
                      {empresa ? (
                        <span className={`inline-flex rounded-lg px-1.5 py-0.5 text-xs font-bold ${EMPRESA_COR[empresa] ?? 'bg-slate-200 text-slate-600'}`}>
                          {empresa}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="font-medium whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {p.nfNumber ? (
                        <button
                          className="text-primaria-600 hover:underline"
                          title="Abrir DANFE (PDF)"
                          onClick={() => abrirDanfe(p)}
                        >
                          {p.nfNumber}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="text-slate-700 max-w-[150px] truncate" title={p.customerName}>{p.customerName}</td>
                    <td>
                      <span className={seloTom(TIPO_TOM[p.tipo])}>
                        {TIPO_LABEL[p.tipo]}
                      </span>
                    </td>
                    <td className="text-slate-500 whitespace-nowrap" title={ORIGEM_LABEL[p.origem]}>{ORIGEM_ABREV[p.origem] ?? p.origem}</td>
                    <td>
                      <span className={seloTom(STATUS_TOM_PENDENCIA[p.status])}>
                        {STATUS_LABEL[p.status]}
                      </span>
                      <PrazoMl p={p} />
                    </td>
                    <td className="whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {canWrite ? (
                        <select
                          className="input input-sm w-auto py-0.5"
                          value={p.responsavel ?? ''}
                          onChange={(e) => respMutation.mutate({ pendencia: p, responsavel: e.target.value || null })}
                        >
                          <option value="">—</option>
                          {RESPONSAVEIS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : (
                        <span className="text-slate-600">{p.responsavel ?? '—'}</span>
                      )}
                    </td>
                    <td className="text-slate-500 whitespace-nowrap">{formatDate(p.createdAt)}</td>
                    <td className="whitespace-nowrap"><DiasBadge p={p} /></td>
                    <td className="text-slate-500 min-w-[180px]">
                      {notasReais.length > 0 ? (
                        <div
                          className="text-xs leading-snug"
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                          title={notasReais.map((n) => `${formatDate(n.createdAt)} — ${n.texto}`).join('\n')}
                        >
                          💬{notasReais.length > 1 ? ` (${notasReais.length})` : ''} {notasReais[0].texto}
                        </div>
                      ) : p.descricao ? (
                        <div
                          className="text-xs leading-snug"
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                          title={p.descricao}
                        >
                          📝 {p.descricao}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        {p.mlClaimId && (
                          <button
                            className="btn-icone text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                            title="Mensagens da reclamação no ML"
                            onClick={() => setMensagensDe(p)}
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                            </svg>
                          </button>
                        )}
                        {canWrite && p.status !== 'RESOLVIDA' && (
                          <button
                            className="btn btn-sm border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                            onClick={() => setResolver(p)}
                          >
                            Resolver
                          </button>
                        )}
                        {p.status === 'RESOLVIDA' && (
                          <span className="text-xs text-emerald-600 font-medium">✓ {p.resolvedAt ? formatDate(p.resolvedAt) : ''}</span>
                        )}
                        {canWrite && (
                          <button
                            className="btn-icone hover:bg-red-50 hover:text-red-600"
                            title="Excluir pendência"
                            onClick={() => excluir(p)}
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  )
                })}
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
          onStatus={(status) => {
            // Resolver pede o texto de conclusão antes de mudar o status
            if (status === 'RESOLVIDA' && detalhe.status !== 'RESOLVIDA') setResolver(detalhe)
            else statusMutation.mutate({ id: detalhe.id, status })
          }}
          onResponsavel={(responsavel) => respMutation.mutate({ pendencia: detalhe, responsavel })}
        />
      )}
      {resolver && (
        <ResolverModal
          pendencia={resolver}
          pending={resolverMutation.isPending}
          onClose={() => setResolver(null)}
          onConfirm={(texto, quem) => resolverMutation.mutate({ pendencia: resolver, texto, quem })}
        />
      )}
      {mensagensDe && <MensagensMlModal pendencia={mensagensDe} onClose={() => setMensagensDe(null)} />}
      {inboxAberto && <InboxMlModal conversas={inbox?.conversas ?? []} erros={inbox?.erros ?? []} onClose={() => setInboxAberto(false)} />}
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
      <div className="alerta-aviso flex flex-wrap items-center gap-3 py-2.5">
        <span className="font-medium text-amber-800">🛒 Mercado Livre:</span>
        {canWrite && naoAutorizadas.map(([c]) => (
          <button key={c} className="btn btn-sm bg-amber-500 text-amber-950 hover:bg-amber-600" onClick={() => conectar(c)}>
            Conectar {c.toUpperCase()}
          </button>
        ))}
        {autorizadas.length === 0 && naoAutorizadas.length === 0 && (
          <span className="text-amber-700">credenciais não configuradas no servidor</span>
        )}
      </div>
    )
  }

  // Rodapé: discreto, quando está tudo conectado
  if (pendenteConexao) return null
  return (
    <div className="flex items-center gap-2 text-xs text-slate-400">
      <span>🛒 Mercado Livre:</span>
      {autorizadas.map(([c]) => (
        <span key={c}>{c.toUpperCase()} ✓</span>
      ))}
      {canWrite && (
        <button
          className="ml-1 underline hover:text-slate-600"
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
        >
          {syncMutation.isPending ? 'sincronizando...' : 'buscar reclamações'}
        </button>
      )}
    </div>
  )
}

// --- Janela de mensagens pós-venda sem resposta (inbox ML) ---
function InboxMlModal({ conversas, erros, onClose }: { conversas: MlConversa[]; erros: string[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [aberta, setAberta] = useState<string | null>(null)
  // conversa cujo rascunho de rastreio está aberto (null = nenhum)
  const [rastreio, setRastreio] = useState<{ company: string; packId: string; comprador: string } | null>(null)
  const varredura = useMutation({
    mutationFn: () => mlApi.varrerMensagens(30),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['ml-inbox'] })
      alert(`Varredura concluída: ${r.verificadas} conversas verificadas, ${r.pendentes} sem resposta.`)
    },
  })
  return (
    <Modal open onClose={onClose} title={`Mensagens ML sem resposta (${conversas.length})`}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-slate-400">
            Conversas do pós-venda em que a última mensagem é do comprador (lidas ou não). Consultar aqui <b>não</b> marca como lida no ML.
          </p>
          <button
            className="btn-secondary btn-sm"
            disabled={varredura.isPending}
            title="Varre todos os pedidos dos últimos 30 dias no ML — pega também mensagens já lidas sem resposta. Pode levar 1-2 min."
            onClick={() => varredura.mutate()}
          >
            {varredura.isPending ? <Spinner className="h-4 w-4" /> : '🔄 Varrer 30 dias'}
          </button>
        </div>
        {erros.length > 0 && (
          <p className="alerta-aviso text-xs">Aviso: {erros.join(' · ')}</p>
        )}
        {conversas.length === 0 && (
          <p className="estado-vazio">Nenhuma mensagem aguardando resposta 🎉</p>
        )}
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {conversas.map((c) => {
            const ultima = c.mensagens[c.mensagens.length - 1]
            const expandida = aberta === c.packId
            return (
              <div key={c.packId} className="rounded-lg border border-slate-200">
                <button
                  className="w-full px-3 py-2 text-left hover:bg-slate-50"
                  onClick={() => setAberta(expandida ? null : c.packId)}
                >
                  <div className="flex items-center gap-2">
                    <span className={`rounded-lg px-1.5 py-0.5 text-xs font-bold ${EMPRESA_COR[c.company] ?? 'bg-slate-200 text-slate-600'}`}>{c.company}</span>
                    <span className="text-sm font-medium text-slate-800 truncate">{c.comprador}</span>
                    <span className={`ml-auto ${seloTom('vermelho')}`}>
                      {c.naoLidas} sem resposta
                    </span>
                  </div>
                  {c.item && <p className="mt-0.5 text-xs text-slate-500 truncate">{c.item}</p>}
                  {ultima && !expandida && (
                    <p className="mt-1 text-xs text-slate-600 truncate">
                      {ultima.de === 'vendedor' ? 'Você: ' : ''}{ultima.texto}
                    </p>
                  )}
                </button>
                {expandida && (
                  <div className="border-t border-slate-100 px-3 py-2 space-y-1.5">
                    {c.mensagens.map((m, i) => (
                      <div key={i} className={`rounded-lg px-2.5 py-1.5 text-xs ${
                        m.de === 'vendedor' ? 'ml-6 bg-primaria-50 text-primaria-800' : 'mr-6 bg-slate-100 text-slate-700'
                      }`}>
                        <p className="whitespace-pre-wrap">{m.texto}</p>
                        <p className="mt-0.5 text-xs opacity-60">
                          {m.de === 'vendedor' ? 'Você' : c.comprador}{m.data ? ` · ${formatDateTime(m.data)}` : ''}
                        </p>
                      </div>
                    ))}
                    <CaixaResposta
                      onEnviar={async (t) => {
                        await mlApi.responderConversa(c.company, c.packId, t)
                        await qc.invalidateQueries({ queryKey: ['ml-inbox'] })
                      }}
                    />
                    <button
                      className="btn-secondary !py-1 text-xs"
                      title="Monta a imagem do rastreio e mostra o rascunho — nada é enviado sem a sua conferência"
                      onClick={() => setRastreio({ company: c.company, packId: c.packId, comprador: c.comprador })}
                    >
                      📦 Responder com o rastreio
                    </button>
                    <a
                      href={`https://www.mercadolivre.com.br/vendas/${c.packId}/detalhe`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block pt-1 text-xs font-medium text-primaria-600 hover:underline"
                    >
                      abrir no Mercado Livre ↗
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {rastreio && (
        <RastreioModal
          company={rastreio.company}
          packId={rastreio.packId}
          comprador={rastreio.comprador}
          onClose={() => setRastreio(null)}
          onEnviado={() => qc.invalidateQueries({ queryKey: ['ml-inbox'] })}
        />
      )}
    </Modal>
  )
}

// --- Modal de mensagens da reclamação ML ---
function MensagensMlModal({ pendencia, onClose }: { pendencia: Pendencia; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: mensagens, isLoading, isError, error } = useQuery({
    queryKey: ['ml-mensagens', pendencia.id],
    queryFn: () => mlApi.mensagens(pendencia.id),
    staleTime: 60000,
    retry: false,
  })

  const DE_LABEL: Record<string, { nome: string; cor: string }> = {
    comprador: { nome: 'Comprador', cor: 'bg-slate-100 text-slate-800' },
    vendedor: { nome: 'Nós', cor: 'bg-primaria-50 text-primaria-800 border border-primaria-100' },
    mediador: { nome: 'Mercado Livre', cor: 'bg-amber-50 text-amber-800 border border-amber-100' },
  }

  return (
    <Modal open onClose={onClose} title={`Mensagens ML — ${pendencia.nfNumber ? `NF ${pendencia.nfNumber}` : pendencia.customerName}`}>
      <div className="space-y-3">
        <PrazoMl p={pendencia} />
        {isLoading && <div className="estado-carregando"><Spinner className="h-6 w-6" /></div>}
        {isError && (
          <p className="alerta-erro">
            {error instanceof Error && 'response' in (error as object)
              ? ((error as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Falha ao buscar mensagens no ML.')
              : 'Falha ao buscar mensagens no ML.'}
          </p>
        )}
        {mensagens && mensagens.length === 0 && (
          <p className="estado-vazio">Nenhuma mensagem nesta reclamação ainda.</p>
        )}
        {mensagens && mensagens.length > 0 && (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {mensagens.map((m, i) => {
              const de = DE_LABEL[m.de] ?? DE_LABEL.comprador
              return (
                <div key={i} className={`rounded-lg px-3 py-2 text-sm ${de.cor} ${m.de === 'vendedor' ? 'ml-8' : 'mr-8'}`}>
                  <p className="whitespace-pre-wrap">{m.texto}</p>
                  <p className="mt-1 text-xs opacity-70">
                    {de.nome}{m.data ? ` · ${formatDateTime(m.data)}` : ''}
                  </p>
                </div>
              )
            })}
          </div>
        )}
        {!isError && !isLoading && (
          <CaixaResposta
            onEnviar={async (t) => {
              await mlApi.responderPendencia(pendencia.id, t)
              await qc.invalidateQueries({ queryKey: ['ml-mensagens', pendencia.id] })
            }}
          />
        )}
        {pendencia.mlOrderId && (
          <a
            href={`https://www.mercadolivre.com.br/vendas/${pendencia.mlOrderId}/detalhe`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs font-medium text-primaria-600 hover:underline"
          >
            abrir no Mercado Livre ↗
          </a>
        )}
      </div>
    </Modal>
  )
}

// --- Modal de conclusão (Resolver) ---
function ResolverModal({ pendencia, pending, onClose, onConfirm }: {
  pendencia: Pendencia
  pending: boolean
  onClose: () => void
  onConfirm: (texto: string, quem: string) => void
}) {
  const [texto, setTexto] = useState('')
  const [quem, setQuem] = useState(pendencia.responsavel ?? '')
  return (
    <Modal open onClose={onClose} title={`Resolver — ${pendencia.nfNumber ? `NF ${pendencia.nfNumber}` : pendencia.customerName}`}>
      <div className="space-y-4">
        <div>
          <label className="label">Quem concluiu? *</label>
          <select className="input" value={quem} onChange={(e) => setQuem(e.target.value)}>
            <option value="">Selecione...</option>
            {RESPONSAVEIS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Como foi resolvido?</label>
          <textarea
            className="input min-h-[90px]"
            placeholder="Ex: cliente recebeu o motor novo; transportadora reembolsou o extravio..."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            autoFocus
          />
          <p className="mt-1 text-xs text-slate-400">O texto entra no histórico de anotações como conclusão.</p>
        </div>
        <div className="flex justify-end gap-3">
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button
            className="btn bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={pending || !quem}
            title={!quem ? 'Selecione quem concluiu' : undefined}
            onClick={() => onConfirm(texto, quem)}
          >
            {pending ? <Spinner className="h-4 w-4" /> : 'Marcar como resolvida'}
          </button>
        </div>
      </div>
    </Modal>
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
  const [responsavel, setResponsavel] = useState('')
  const [descricao, setDescricao] = useState('')

  function reset() {
    setNf(''); setEmpresa(''); setLookupResult(null); setPedido(null); setCliente(''); setTipo('DEFEITO'); setResponsavel(''); setDescricao('')
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
        responsavel: responsavel || undefined,
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
            <p className="mt-1 text-xs text-slate-400">Buscando no painel e no Bling — pode levar alguns segundos...</p>
          )}
          {lookupResult && lookupResult.length === 0 && (
            <p className="mt-1 text-xs text-amber-700">
              NF não encontrada no painel nem no Bling (últimos 6 meses){empresa ? '' : ' — tente selecionar a empresa'}. Preencha o cliente manualmente.
            </p>
          )}
          {lookupResult && lookupResult.length > 1 && (
            <div className="mt-2 space-y-1">
              {lookupResult.map((o) => (
                <button
                  key={o.id ?? o.orderNumber}
                  type="button"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-primaria-50"
                  onClick={() => selecionarPedido(o)}
                >
                  <span className="font-medium">{o.orderNumber}</span> — {o.customerName}
                </button>
              ))}
            </div>
          )}
          {pedido && (
            <div className="alerta-info mt-2 px-3 py-2 text-xs">
              ✓ <b>{pedido.orderNumber}</b> — {pedido.customerName}
              {pedido.carrier && <> · {pedido.carrier.name}</>}
              {pedido.fonte === 'bling' && <> · <span className="text-primaria-500">via Bling (sem rastreio no painel)</span></>}
              {pedido.lastTracking && <div className="mt-1 text-primaria-600 truncate">Rastreio: {pedido.lastTracking}</div>}
            </div>
          )}
        </div>

        <div>
          <label className="label">Cliente *</label>
          <input className="input" placeholder="Nome do cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Tipo *</label>
            <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value as PendenciaTipo)}>
              {Object.entries(TIPO_LABEL).filter(([k]) => k !== 'RECLAMACAO_ML').map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Responsável</label>
            <select className="input" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
              <option value="">Ninguém</option>
              {RESPONSAVEIS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
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

        {createMutation.isError && <p className="alerta-erro">Erro ao salvar. Verifique os campos.</p>}

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
function DetalheModal({ pendencia, canWrite, onClose, onStatus, onResponsavel }: {
  pendencia: Pendencia
  canWrite: boolean
  onClose: () => void
  onStatus: (s: PendenciaStatus) => void
  onResponsavel: (r: string | null) => void
}) {
  const qc = useQueryClient()
  const [novaNota, setNovaNota] = useState('')
  const [rastreioAberto, setRastreioAberto] = useState(false)
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
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div><span className="text-slate-500">Cliente:</span> <span className="font-medium">{pendencia.customerName}</span></div>
          <div><span className="text-slate-500">Empresa:</span> {empresaSigla(pendencia.senderCnpj) ?? '—'}</div>
          <div><span className="text-slate-500">Origem:</span> {ORIGEM_LABEL[pendencia.origem]}</div>
          <div><span className="text-slate-500">Criada em:</span> {formatDate(pendencia.createdAt)}</div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <span className="text-slate-500">Responsável:</span>
            {canWrite ? (
              <select
                className="input input-sm w-auto"
                value={pendencia.responsavel ?? ''}
                onChange={(e) => onResponsavel(e.target.value || null)}
              >
                <option value="">Ninguém</option>
                {RESPONSAVEIS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            ) : (
              <span className="font-medium">{pendencia.responsavel ?? '—'}</span>
            )}
          </div>
          {pendencia.order?.carrier && (
            <div className="sm:col-span-2"><span className="text-slate-500">Transportadora:</span> {pendencia.order.carrier.name}</div>
          )}
          {pendencia.order && (
            <div className="sm:col-span-2">
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <div className="flex-1 min-w-0">
                  <b>Rastreio:</b> {pendencia.order.lastTracking ?? 'sem movimentação'}
                  <div className="mt-0.5 text-xs text-slate-400">
                    {pendencia.order.orderNumber}
                    {pendencia.order.shippedAt && ` · envio ${formatDate(pendencia.order.shippedAt)}`}
                    {pendencia.order.estimatedDelivery && ` · previsão ${formatDate(pendencia.order.estimatedDelivery)}`}
                    {pendencia.order.deliveredAt && ` · entregue ${formatDate(pendencia.order.deliveredAt)}`}
                  </div>
                </div>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setRastreioAberto((v) => !v)}
                >
                  🚚 {rastreioAberto ? 'Ocultar' : 'Rastreio'}
                </button>
              </div>
              {rastreioAberto && (
                <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {(pendencia.order.trackingEvents ?? []).length === 0 ? (
                    <p className="estado-vazio py-4 text-xs">Nenhum evento de rastreio registrado.</p>
                  ) : (
                    <ol className="linha-tempo ml-2 mt-1">
                      {(pendencia.order.trackingEvents ?? []).map((e, i) => (
                        <li key={i} className="linha-tempo-item">
                          <span className={`linha-tempo-ponto ${i === 0 ? 'linha-tempo-ponto-atual' : ''}`} />
                          <p className={`text-xs ${i === 0 ? 'font-medium text-slate-800' : 'text-slate-600'}`}>{e.description}</p>
                          {e.date && <p className="linha-tempo-data">{formatDateTime(e.date)}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          )}
          {pendencia.descricao && (
            <div className="alerta-aviso whitespace-pre-wrap px-3 py-2 text-xs sm:col-span-2">
              {pendencia.descricao}
            </div>
          )}
          {pendencia.mlClaimId && <div className="sm:col-span-2"><PrazoMl p={pendencia} /></div>}
          {pendencia.mlClaimId && (
            <div className="sm:col-span-2 flex items-center gap-2 text-xs text-slate-500">
              <span>Reclamação ML #{pendencia.mlClaimId}{pendencia.mlOrderId ? ` · Venda ${pendencia.mlOrderId}` : ''}</span>
              {pendencia.mlOrderId && (
                <a
                  href={`https://www.mercadolivre.com.br/vendas/${pendencia.mlOrderId}/detalhe`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primaria-600 hover:underline"
                >
                  Abrir no Mercado Livre ↗
                </a>
              )}
            </div>
          )}
        </div>

        {/* Status */}
        {canWrite && (
          <div className="flex gap-2">
            {(['ABERTA', 'EM_TRATAMENTO', 'RESOLVIDA'] as PendenciaStatus[]).map((s) => (
              <button
                key={s}
                className={`flex-1 ${pendencia.status === s ? `btn btn-sm border font-semibold ${TOM[STATUS_TOM_PENDENCIA[s]].selo}` : 'btn-secondary btn-sm'}`}
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
            <p className="text-xs text-slate-500">Nenhuma anotação ainda.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {notas.map((n) => (
                <div key={n.id} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{n.texto}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatDateTime(n.createdAt)}{n.autor ? ` · ${n.autor}` : ''}
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


// Caixa de resposta compartilhada: manda a mensagem DIRETO ao ML (reclamação ou pós-venda)
function CaixaResposta({ onEnviar }: { onEnviar: (texto: string) => Promise<unknown> }) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async () => {
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true)
    setErro(null)
    try {
      await onEnviar(t)
      setTexto('')
    } catch (e) {
      setErro((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Falha ao enviar')
    } finally {
      setEnviando(false)
    }
  }
  return (
    <div className="pt-2 space-y-1">
      <div className="flex gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          placeholder="Escreva a resposta — vai direto para o Mercado Livre"
          className="input flex-1 resize-y"
        />
        <button
          className="btn-primary self-end"
          disabled={enviando || !texto.trim()}
          onClick={enviar}
        >
          {enviando ? <Spinner className="h-4 w-4" /> : 'Enviar'}
        </button>
      </div>
      {erro && <p className="alerta-erro text-xs">{erro}</p>}
    </div>
  )
}

/**
 * Responder o cliente com a imagem do rastreio, em um clique.
 *
 * Mostra o RASCUNHO antes de qualquer coisa: a imagem que iria anexada e o texto, que dá
 * para editar. Nada sai sem o clique em Enviar — mensagem automática é motivo de
 * moderação no Mercado Livre (AUTOMATIC_MESSAGE) e a conta já foi bloqueada uma vez.
 */
function RastreioModal(
  { company, packId, comprador, onClose, onEnviado }:
  { company: string; packId: string; comprador: string; onClose: () => void; onEnviado: () => void },
) {
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const rascunho = useQuery({
    queryKey: ['rascunho-rastreio', company, packId],
    queryFn: () => mlApi.rascunhoRastreio(company, packId),
    retry: false,
    refetchOnWindowFocus: false,
    // sempre remontar: o backend guarda a imagem conferida por 15 min e o envio usa
    // ELA. Pegar do cache deixaria a tela sem o rascunho correspondente no servidor.
    gcTime: 0,
    staleTime: 0,
  })
  // preenche o texto sugerido uma vez, sem apagar o que o José já tiver escrito
  useEffect(() => {
    if (rascunho.data?.texto) setTexto((t) => (t.trim() ? t : rascunho.data.texto))
  }, [rascunho.data?.texto])
  const envio = useMutation({
    mutationFn: () => mlApi.enviarRastreio(company, packId, texto.trim()),
    onSuccess: () => { onEnviado(); onClose() },
    onError: (e) => setErro(
      (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Falha ao enviar',
    ),
  })

  const limite = rascunho.data?.limite ?? 350
  const sobrando = limite - texto.trim().length
  const motivoFalha = (rascunho.error as { response?: { data?: { error?: string } } })
    ?.response?.data?.error

  return (
    <Modal open onClose={onClose} title={`Responder ${comprador} com o rastreio`}>
      <div className="space-y-3">
        {rascunho.isPending && (
          <p className="flex items-center gap-2 py-6 justify-center text-sm text-gray-500">
            <Spinner className="h-4 w-4" /> Montando a imagem do rastreio…
          </p>
        )}
        {rascunho.isError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {motivoFalha ?? 'Não consegui montar o rascunho.'}
          </p>
        )}
        {rascunho.data && (
          <>
            <p className="text-xs text-gray-500">
              Pedido <b>{rascunho.data.pedido}</b>. A imagem vai anexada na conversa do
              Mercado Livre. Os dados do destinatário ficam de fora, e documento e telefone
              são apagados das descrições — mas o texto dos eventos vem da transportadora,
              então <b>confira antes de enviar</b>.
            </p>
            <img
              src={rascunho.data.imagem}
              alt="Rastreio que será enviado ao cliente"
              className="w-full rounded-lg border border-gray-200"
            />
            <div className="space-y-1">
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <p className={`text-right text-[11px] ${sobrando < 0 ? 'font-bold text-red-600' : 'text-gray-400'}`}>
                {sobrando < 0
                  ? `${-sobrando} caractere(s) a mais do que o Mercado Livre aceita (${limite})`
                  : `${sobrando} de ${limite} caracteres restantes`}
              </p>
            </div>
            {erro && <p className="text-xs text-red-600">{erro}</p>}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary !py-1.5 text-sm" onClick={onClose}>Cancelar</button>
              <button
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
                disabled={envio.isPending || !texto.trim() || sobrando < 0}
                onClick={() => { setErro(null); envio.mutate() }}
              >
                {envio.isPending ? <Spinner className="h-4 w-4" /> : 'Enviar ao cliente'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
