import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mlApi, type MlEnvio, type MlEnviosCiclo } from '../lib/api'

const EMPRESA_LABEL: Record<string, string> = { avic: 'AVIC', agro: 'Agrogranja' }

function data(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('pt-BR')
}
function dataHora(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** O que falta avisar ao ML neste pedido. */
function pendencia(e: MlEnvio): 'nada' | 'shipped' | 'delivered' | 'ambos' {
  const faltaShipped = !e.mlShippedNotifiedAt && e.status !== 'PENDING'
  const faltaDelivered = e.status === 'DELIVERED' && !e.mlDeliveredNotifiedAt
  if (faltaShipped && faltaDelivered) return 'ambos'
  if (faltaDelivered) return 'delivered'
  if (faltaShipped && e.status === 'IN_TRANSIT' && e.lastTracking) return 'shipped'
  return 'nada'
}

function Selo({ texto, cor }: { texto: string; cor: string }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${cor}`}>{texto}</span>
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
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Envios no Mercado Livre (ME1)</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            O ML exige que o vendedor informe quando despachou e quando entregou. Isto avisa por você,
            a partir do rastreio das transportadoras.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => ciclo.mutate(true)}
            disabled={ciclo.isPending}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Avisar agora
          </button>
        </div>
      </div>

      {/* Situação */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500">Vendas ME1 acompanhadas</p>
          <p className="text-2xl font-bold text-gray-900">{envios.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Esperando aviso</p>
          <p className={`text-2xl font-bold ${nPendentes ? 'text-amber-600' : 'text-green-600'}`}>{nPendentes}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Com erro</p>
          <p className={`text-2xl font-bold ${nErros ? 'text-red-600' : 'text-gray-400'}`}>{nErros}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500">Automático (30 min)</p>
          <p className={`text-lg font-bold ${cfg?.auto ? 'text-green-600' : 'text-gray-400'}`}>
            {cfg?.auto ? '● Ligado' : '○ Desligado'}
          </p>
        </div>
      </div>

      {/* O que é enviado ao comprador */}
      {cfg && (
        <div className="card p-4 text-xs text-gray-600 space-y-1">
          <p className="font-semibold text-gray-700">O que o comprador vê no despacho</p>
          <p>
            Código de rastreio: <span className="font-mono text-gray-900">{cfg.trackingMsg}</span>
            <span className="text-gray-400"> — o ML aceita só letras e números neste campo, por isso as maiúsculas no lugar dos espaços</span>
          </p>
          <p>Link: <span className="font-mono text-gray-900">{cfg.portalUrl}</span></p>
          <p>Mensagem: <span className="text-gray-900">{cfg.trackingComentario}</span></p>
        </div>
      )}

      {/* Resultado da última execução */}
      {resultado && (
        <div className={`card p-4 text-sm ${resultado.dryRun ? 'border-l-4 border-l-blue-400' : 'border-l-4 border-l-green-500'}`}>
          <div className="flex items-center justify-between">
            <p className="font-semibold text-gray-800">
              {resultado.dryRun ? 'Simulação — nada foi enviado ao ML' : 'Avisos enviados ao ML'}
            </p>
            <button onClick={() => setResultado(null)} className="text-xs text-gray-400 hover:text-gray-600">fechar</button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {resultado.vinculados} venda(s) vinculada(s) · {resultado.me1} ME1 em aberto · {resultado.processados} aviso(s)
          </p>
          {resultado.resultados.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs max-h-52 overflow-y-auto">
              {resultado.resultados.map((r) => (
                <li key={r.orderNumber} className={r.ok ? 'text-gray-600' : 'text-red-600'}>
                  {r.ok ? '✓' : '✗'} {r.orderNumber} → {r.acao === 'shipped' ? 'a caminho' : r.acao === 'delivered' ? 'entregue' : 'a caminho + entregue'}
                  {r.erro && <span className="text-red-500"> · {r.erro}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Lista */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <p className="text-sm font-semibold text-gray-700">Vendas ME1</p>
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
            <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300" />
            só as que faltam avisar
          </label>
        </div>

        {isLoading ? (
          <p className="px-4 py-10 text-center text-sm text-gray-400">carregando…</p>
        ) : lista.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-gray-500">
            <svg className="h-12 w-12 mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-medium">
              {soPendentes ? 'Nenhum aviso pendente 🎉' : 'Nenhuma venda ME1 acompanhada ainda'}
            </p>
            {!soPendentes && <p className="text-xs mt-1">Use “Simular” para procurar vendas ME1 recentes.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Empresa</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">NF</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Cliente</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Entrega</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Avisado “a caminho”</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500">Avisado “entregue”</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 w-full">Situação</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-500">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lista.map((e) => {
                  const falta = pendencia(e)
                  return (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                        {EMPRESA_LABEL[e.mlCompany ?? ''] ?? '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="font-medium text-gray-800">{e.nfNumber ?? '—'}</span>
                        {e.mlOrderId && (
                          <a href={`https://www.mercadolivre.com.br/vendas/${e.mlOrderId}/detalhe`}
                            target="_blank" rel="noreferrer"
                            className="ml-1.5 text-blue-600 hover:underline" title="Abrir a venda no Mercado Livre">↗</a>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-[15rem] truncate" title={e.customerName}>{e.customerName}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {e.status === 'DELIVERED'
                          ? <Selo texto={`entregue ${data(e.deliveredAt)}`} cor="bg-green-50 text-green-700" />
                          : e.status === 'IN_TRANSIT'
                            ? <Selo texto={`em trânsito ${data(e.shippedAt)}`} cor="bg-blue-50 text-blue-700" />
                            : <Selo texto={e.status === 'PENDING' ? 'aguardando CT-e' : 'cancelado'} cor="bg-gray-100 text-gray-500" />}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{dataHora(e.mlShippedNotifiedAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{dataHora(e.mlDeliveredNotifiedAt)}</td>
                      <td className="px-3 py-2">
                        {e.mlEnvioErro
                          ? <span className="text-red-600" title={e.mlEnvioErro}>erro: {e.mlEnvioErro.slice(0, 60)}</span>
                          : falta === 'nada'
                            ? <span className="text-green-600">em dia</span>
                            : <span className="text-amber-600">
                                falta avisar {falta === 'ambos' ? '“a caminho” e “entregue”' : falta === 'delivered' ? '“entregue”' : '“a caminho”'}
                              </span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {falta === 'nada' ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <div className="inline-flex gap-1">
                            {(falta === 'shipped' || falta === 'ambos') && (
                              <button
                                onClick={() => notificar.mutate({ id: e.id, status: 'shipped' })}
                                disabled={notificar.isPending}
                                className="rounded border border-blue-200 bg-blue-50 px-2 py-1 font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
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
                                className="rounded border border-green-200 bg-green-50 px-2 py-1 font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
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
