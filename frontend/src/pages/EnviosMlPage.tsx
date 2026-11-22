import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mlApi, type MlEnvio, type MlEnviosCiclo } from '../lib/api'
import { formatDate, formatDateTime, STATUS_TOM } from '../lib/utils'
import { seloTom, type Tom } from '../lib/estilo'

const EMPRESA_LABEL: Record<string, string> = { avic: 'AVIC', agro: 'Agrogranja', equi: 'Equipage' }


/** O que falta avisar ao ML neste pedido. */
function pendencia(e: MlEnvio): 'nada' | 'shipped' | 'delivered' | 'ambos' {
  const faltaShipped = !e.mlShippedNotifiedAt && e.status !== 'PENDING'
  const faltaDelivered = e.status === 'DELIVERED' && !e.mlDeliveredNotifiedAt
  if (faltaShipped && faltaDelivered) return 'ambos'
  if (faltaDelivered) return 'delivered'
  if (faltaShipped && e.status === 'IN_TRANSIT' && e.lastTracking) return 'shipped'
  return 'nada'
}

function Selo({ texto, tom }: { texto: string; tom: Tom }) {
  return <span className={seloTom(tom)}>{texto}</span>
}

/** Dia (sem hora) — o ML mede atraso por data, não por horário. */
function soDia(s: string) {
  const d = new Date(s)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Prazo prometido pelo ML ao comprador. É por ele que o marketplace conta atraso —
 * e ele costuma ser mais curto que a previsão da transportadora, por isso uma entrega
 * "no prazo" para nós aparece como atrasada no ML.
 */
function PrazoMl({ e }: { e: MlEnvio }) {
  if (!e.mlPromessaEntrega) return <span className="text-slate-300">—</span>
  const prazo = soDia(e.mlPromessaEntrega)
  const ref = e.status === 'DELIVERED' && e.deliveredAt ? soDia(e.deliveredAt) : soDia(new Date().toISOString())
  const dias = Math.round((ref - prazo) / 86400000)
  const entregue = e.status === 'DELIVERED'

  const tom: Tom = dias > 0 ? 'vermelho' : dias === 0 ? 'ambar' : 'cinza'
  const texto = dias > 0
    ? `${formatDate(e.mlPromessaEntrega)} · ${entregue ? `atrasou ${dias}d` : `venceu há ${dias}d`}`
    : dias === 0 ? `${formatDate(e.mlPromessaEntrega)} · vence hoje`
    : `${formatDate(e.mlPromessaEntrega)} · faltam ${-dias}d`

  return <span title="Prazo prometido pelo ML ao comprador"><Selo texto={texto} tom={tom} /></span>
}

export function EnviosMlPage() {
  const qc = useQueryClient()
  const [resultado, setResultado] = useState<MlEnviosCiclo | null>(null)
  const [soPendentes, setSoPendentes] = useState(false)

  const { data: resp, isLoading } = useQuery({
    queryKey: ['ml-envios'],
    queryFn: mlApi.enviosPendentes,
    refetchInterval: 60000,
  })

  const ciclo = useMutation({
    mutationFn: (dryRun: boolean) => mlApi.enviosSincronizar(dryRun),
    onSuccess: (d) => {
      setResultado(d)
      qc.invalidateQueries({ queryKey: ['ml-envios'] })
    },
  })

  const notificar = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'shipped' | 'delivered' }) =>
      mlApi.enviosNotificar(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ml-envios'] }),
  })

  const envios = resp?.pendentes ?? []
  const lista = soPendentes ? envios.filter((e) => pendencia(e) !== 'nada') : envios
  const nPendentes = envios.filter((e) => pendencia(e) !== 'nada').length
  const nErros = envios.filter((e) => e.mlEnvioErro).length
  const cfg = resp?.config

  return (
    <div className="pagina">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="pagina-titulo">Envios no Mercado Livre (ME1)</h1>
          <p className="pagina-subtitulo">
            O ML exige que o vendedor informe quando despachou e quando entregou. Isto avisa por você,
            a partir do rastreio das transportadoras.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => ciclo.mutate(true)}
            disabled={ciclo.isPending}
            className="btn-secondary"
          >
            {ciclo.isPending ? 'Verificando…' : 'Simular'}
          </button>
          <button
            onClick={() => {
              if (confirm('Avisar o Mercado Livre agora?\n\nO aviso de ENTREGA é definitivo e não pode ser desfeito.')) {
                ciclo.mutate(false)
              }
            }}
            disabled={ciclo.isPending}
            className="btn-primary"
          >
            Avisar agora
          </button>
        </div>
      </div>

      {/* Situação */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="resumo">
          <p className="resumo-rotulo">Vendas ME1 acompanhadas</p>
          <p className="resumo-valor">{envios.length}</p>
        </div>
        <div className="resumo">
          <p className="resumo-rotulo">Esperando aviso</p>
          <p className={`resumo-valor ${nPendentes ? 'text-amber-700' : 'text-emerald-700'}`}>{nPendentes}</p>
        </div>
        <div className="resumo">
          <p className="resumo-rotulo">Com erro</p>
          <p className={`resumo-valor ${nErros ? 'text-red-700' : 'text-slate-400'}`}>{nErros}</p>
        </div>
        <div className="resumo">
          <p className="resumo-rotulo">Automático (30 min)</p>
          <p className={`mt-1 text-lg font-bold ${cfg?.auto ? 'text-emerald-700' : 'text-slate-400'}`}>
            {cfg?.auto ? '● Ligado' : '○ Desligado'}
          </p>
        </div>
      </div>

      {/* O que é enviado ao comprador */}
      {cfg && (
        <div className="card p-4 text-xs text-slate-600 space-y-1">
          <p className="font-semibold text-slate-700">O que o comprador vê no despacho</p>
          <p>
            Código de rastreio: <span className="font-mono text-slate-900">{cfg.trackingMsg}</span>
            <span className="text-slate-400"> — o ML aceita só letras e números neste campo, por isso as maiúsculas no lugar dos espaços</span>
          </p>
          <p>Link: <span className="font-mono text-slate-900">{cfg.portalUrl}</span></p>
          <p>Mensagem: <span className="text-slate-900">{cfg.trackingComentario}</span></p>
        </div>
      )}

      {/* Resultado da última execução */}
      {resultado && (
        <div className={resultado.dryRun ? 'alerta-info' : 'alerta-ok'}>
          <div className="flex items-center justify-between">
            <p className="font-semibold">
              {resultado.dryRun ? 'Simulação — nada foi enviado ao ML' : 'Avisos enviados ao ML'}
            </p>
            <button onClick={() => setResultado(null)} className="btn-ghost btn-sm">fechar</button>
          </div>
          <p className="mt-1 text-xs opacity-80">
            {resultado.vinculados} venda(s) vinculada(s) · {resultado.me1} ME1 em aberto · {resultado.processados} aviso(s)
          </p>
          {resultado.resultados.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs max-h-52 overflow-y-auto">
              {resultado.resultados.map((r) => (
                <li key={r.orderNumber} className={r.ok ? '' : 'text-red-700'}>
                  {r.ok ? '✓' : '✗'} {r.orderNumber} → {r.acao === 'shipped' ? 'a caminho' : r.acao === 'delivered' ? 'entregue' : 'a caminho + entregue'}
                  {r.erro && <span className="text-red-700"> · {r.erro}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Lista */}
      <div className="card overflow-hidden">
        <div className="card-cabecalho">
          <p className="secao-titulo">Vendas ME1</p>
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)}
              className="checkbox" />
            só as que faltam avisar
          </label>
        </div>

        {isLoading ? (
          <p className="estado-carregando">carregando…</p>
        ) : lista.length === 0 ? (
          <div className="estado-vazio">
            <svg className="h-12 w-12 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-medium text-slate-700">
              {soPendentes ? 'Nenhum aviso pendente 🎉' : 'Nenhuma venda ME1 acompanhada ainda'}
            </p>
            {!soPendentes && <p className="text-xs mt-1">Use “Simular” para procurar vendas ME1 recentes.</p>}
          </div>
        ) : (
          <div className="tabela-caixa">
            <table className="tabela tabela-compacta">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>NF</th>
                  <th>Cliente</th>
                  <th>Entrega</th>
                  <th title="Prazo que o ML promete ao comprador — é por ele que o ML mede atraso">Prazo ML</th>
                  <th>Avisado “a caminho”</th>
                  <th>Avisado “entregue”</th>
                  <th className="w-full">Situação</th>
                  <th className="text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((e) => {
                  const falta = pendencia(e)
                  return (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap text-slate-500">
                        {EMPRESA_LABEL[e.mlCompany ?? ''] ?? '—'}
                      </td>
                      <td className="whitespace-nowrap">
                        <span className="font-medium text-slate-800">{e.nfNumber ?? '—'}</span>
                        {e.mlOrderId && (
                          <a href={`https://www.mercadolivre.com.br/vendas/${e.mlOrderId}/detalhe`}
                            target="_blank" rel="noreferrer"
                            className="ml-1.5 text-primaria-600 hover:underline" title="Abrir a venda no Mercado Livre">↗</a>
                        )}
                      </td>
                      <td className="max-w-[15rem] truncate" title={e.customerName}>{e.customerName}</td>
                      <td className="whitespace-nowrap">
                        {e.status === 'DELIVERED'
                          ? <Selo texto={`entregue ${formatDate(e.deliveredAt)}`} tom={STATUS_TOM.DELIVERED} />
                          : e.status === 'IN_TRANSIT'
                            ? <Selo texto={`em trânsito ${formatDate(e.shippedAt)}`} tom={STATUS_TOM.IN_TRANSIT} />
                            : <Selo texto={e.status === 'PENDING' ? 'aguardando CT-e' : 'cancelado'} tom="cinza" />}
                      </td>
                      <td className="whitespace-nowrap"><PrazoMl e={e} /></td>
                      <td className="whitespace-nowrap text-slate-500">{formatDateTime(e.mlShippedNotifiedAt)}</td>
                      <td className="whitespace-nowrap text-slate-500">{formatDateTime(e.mlDeliveredNotifiedAt)}</td>
                      <td>
                        {e.mlEnvioErro
                          ? <span className="text-red-700" title={e.mlEnvioErro}>erro: {e.mlEnvioErro.slice(0, 60)}</span>
                          : falta === 'nada'
                            ? <span className="text-emerald-700">em dia</span>
                            : <span className="text-amber-700">
                                falta avisar {falta === 'ambos' ? '“a caminho” e “entregue”' : falta === 'delivered' ? '“entregue”' : '“a caminho”'}
                              </span>}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {falta === 'nada' ? (
                          <span className="text-slate-300">—</span>
                        ) : (
                          <div className="inline-flex gap-1">
                            {(falta === 'shipped' || falta === 'ambos') && (
                              <button
                                onClick={() => notificar.mutate({ id: e.id, status: 'shipped' })}
                                disabled={notificar.isPending}
                                className="btn-outline btn-sm"
                              >
                                a caminho
                              </button>
                            )}
                            {(falta === 'delivered' || falta === 'ambos') && (
                              <button
                                onClick={() => {
                                  if (confirm(`Avisar ENTREGA da NF ${e.nfNumber} no Mercado Livre?\n\nEsse aviso é definitivo e não pode ser desfeito.`)) {
                                    notificar.mutate({ id: e.id, status: 'delivered' })
                                  }
                                }}
                                disabled={notificar.isPending}
                                className="btn btn-sm border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                              >
                                entregue
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
