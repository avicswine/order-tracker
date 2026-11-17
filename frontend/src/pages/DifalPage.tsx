import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { difalApi } from '../lib/api'
import type { DifalNota, DifalResponsavel } from '../lib/api'

function brl(v: number | null | undefined) {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function dataBr(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR')
}

// Como cada responsável aparece na tela.
const RESPONSAVEL: Record<DifalResponsavel, { texto: string; cor: string; ajuda: string }> = {
  NOSSO: {
    texto: 'Nós pagamos',
    cor: 'bg-amber-100 text-amber-800',
    ajuda: 'Venda de balcão ou Loja Integrada para quem não tem inscrição estadual: a guia é nossa',
  },
  ML_PAGA: {
    texto: 'Mercado Livre',
    cor: 'bg-blue-100 text-blue-800',
    ajuda: 'O ML recolhe e depois cobra de nós no faturamento',
  },
  CLIENTE: {
    texto: 'Cliente',
    cor: 'bg-gray-100 text-gray-600',
    ajuda: 'Destinatário com inscrição estadual apura o próprio DIFAL',
  },
  SEM_DIFAL: {
    texto: 'Sem DIFAL',
    cor: 'bg-gray-100 text-gray-500',
    ajuda: 'Venda dentro do Rio Grande do Sul: não há diferencial',
  },
}

const SITUACAO: Record<string, { texto: string; cor: string }> = {
  PENDENTE: { texto: 'Pendente', cor: 'bg-gray-100 text-gray-700' },
  CONFERIDO: { texto: 'Conferido', cor: 'bg-green-100 text-green-800' },
  DIVERGENTE: { texto: 'Divergente', cor: 'bg-red-100 text-red-800' },
  PAGO: { texto: 'Pago', cor: 'bg-green-100 text-green-800' },
  ATRASADO: { texto: 'Atrasado', cor: 'bg-red-100 text-red-800' },
}

function Cartao({
  titulo,
  valor,
  detalhe,
  alerta,
}: {
  titulo: string
  valor: string
  detalhe?: string
  alerta?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        alerta ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="text-xs text-gray-500">{titulo}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          alerta ? 'text-amber-800' : 'text-gray-900'
        }`}
      >
        {valor}
      </div>
      {detalhe && <div className="mt-1 text-xs text-gray-500">{detalhe}</div>}
    </div>
  )
}

export function DifalPage() {
  const [responsavel, setResponsavel] = useState('')
  const [uf, setUf] = useState('')
  const [busca, setBusca] = useState('')
  const qc = useQueryClient()

  const { data: resumo } = useQuery({
    queryKey: ['difal-resumo'],
    queryFn: () => difalApi.resumo(),
  })

  const { data: lista, isLoading } = useQuery({
    queryKey: ['difal-notas', responsavel, uf, busca],
    queryFn: () =>
      difalApi.listar({
        responsavel: responsavel || undefined,
        uf: uf || undefined,
        busca: busca || undefined,
      }),
  })

  const importar = useMutation({
    mutationFn: () => difalApi.importar(90),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['difal-notas'] })
      qc.invalidateQueries({ queryKey: ['difal-resumo'] })
    },
  })

  const notas = lista?.notas ?? []
  const nosso = resumo?.porResponsavel.find((r) => r.responsavel === 'NOSSO')
  const ml = resumo?.porResponsavel.find((r) => r.responsavel === 'ML_PAGA')
  const totalNotas = lista?.total ?? 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">DIFAL</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-600">
            Diferencial de alíquota de cada nota, calculado pelo NCM e pelo estado de destino.
            Os produtos de NCM 8436 têm a redução do Convênio 52/91: carga total de 5,6%, com
            4,1% já recolhidos na origem, restando 1,5% para o destino.
          </p>
        </div>
        <button
          onClick={() => importar.mutate()}
          disabled={importar.isPending}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {importar.isPending ? 'Buscando notas…' : 'Atualizar do Bling'}
        </button>
      </div>

      {importar.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Não foi possível buscar as notas: {(importar.error as Error).message}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cartao
          titulo="Guias que precisamos pagar"
          valor={brl(resumo?.aPagar.valor)}
          detalhe={`${resumo?.aPagar.notas ?? 0} nota(s) de balcão ou Loja Integrada`}
          alerta={(resumo?.aPagar.valor ?? 0) > 0}
        />
        <Cartao
          titulo="O Mercado Livre recolhe"
          valor={brl(ml?.calculado)}
          detalhe={`${ml?.notas ?? 0} nota(s) · cobrado de nós: ${brl(ml?.cobradoMl)}`}
        />
        <Cartao
          titulo="Divergências com o ML"
          valor={brl(resumo?.divergentes.valor)}
          detalhe={`${resumo?.divergentes.notas ?? 0} nota(s) com valor diferente do calculado`}
          alerta={(resumo?.divergentes.notas ?? 0) > 0}
        />
        <Cartao
          titulo="Notas de balcão no período"
          valor={String(nosso?.notas ?? 0)}
          detalhe={`DIFAL calculado: ${brl(nosso?.calculado)}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={responsavel}
          onChange={(e) => setResponsavel(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Todos os responsáveis</option>
          <option value="NOSSO">Nós pagamos</option>
          <option value="ML_PAGA">Mercado Livre paga</option>
          <option value="CLIENTE">Cliente contribuinte</option>
          <option value="SEM_DIFAL">Sem DIFAL</option>
        </select>
        <input
          value={uf}
          onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))}
          placeholder="UF"
          className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase"
        />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Número da NF ou cliente"
          className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <span className="text-sm text-gray-500">
          {totalNotas} {totalNotas === 1 ? 'nota' : 'notas'}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left">NF</th>
              <th className="px-3 py-2 text-left">Emissão</th>
              <th className="px-3 py-2 text-left">Cliente</th>
              <th className="px-3 py-2 text-left">UF</th>
              <th className="px-3 py-2 text-left">Canal</th>
              <th className="px-3 py-2 text-right">Valor da nota</th>
              <th className="px-3 py-2 text-right">DIFAL</th>
              <th className="px-3 py-2 text-right">Cobrado ML</th>
              <th className="px-3 py-2 text-left">Quem paga</th>
              <th className="px-3 py-2 text-left">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-gray-500">
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && notas.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-gray-500">
                  Nenhuma nota ainda. Clique em &ldquo;Atualizar do Bling&rdquo; para buscar.
                </td>
              </tr>
            )}
            {notas.map((n: DifalNota) => {
              const r = RESPONSAVEL[n.responsavel]
              const s = SITUACAO[n.situacao] ?? SITUACAO.PENDENTE
              return (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {n.nfNumero}
                    <span className="ml-1 text-xs text-gray-400">{n.empresa}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{dataBr(n.emitidaEm)}</td>
                  <td
                    className="max-w-[220px] truncate px-3 py-2 text-gray-700"
                    title={n.clienteNome}
                  >
                    {n.clienteNome}
                    {n.clienteTemIe && (
                      <span className="ml-1 text-xs text-gray-400" title="Tem inscrição estadual">
                        IE
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{n.clienteUf}</td>
                  <td
                    className="max-w-[140px] truncate px-3 py-2 text-gray-600"
                    title={n.canalNome ?? undefined}
                  >
                    {n.canalNome ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                    {brl(n.valorNota)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-gray-900">
                    {brl(n.difalCalculado)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                    {n.difalCobradoMl == null ? '—' : brl(n.difalCobradoMl)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${r.cor}`} title={r.ajuda}>
                      {r.texto}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${s.cor}`}>{s.texto}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
