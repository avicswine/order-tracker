import { Fragment, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { difalApi } from '../lib/api'
import type {
  DifalNota, DifalResponsavel, DifalHistorico, DifalGuiaPendente, DifalFechamentoMes,
  DifalLote, DifalAliquota, DifalReceitaUf,
} from '../lib/api'

function brl(v: number | null | undefined) {
  return (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function pct(v: number | null | undefined) {
  return `${(v ?? 0).toFixed(2).replace('.', ',')}%`
}

function dataBr(iso: string) {
  // A data da nota é um dia de calendário, não um instante. Lendo como UTC e
  // formatando em UTC, nota emitida de madrugada não aparece no dia anterior.
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

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

function Numero({
  titulo,
  valor,
  detalhe,
  tom = 'normal',
}: {
  titulo: string
  valor: string
  detalhe?: string
  tom?: 'normal' | 'alerta' | 'ok'
}) {
  const borda =
    tom === 'alerta' ? 'border-amber-300 bg-amber-50' : tom === 'ok' ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-white'
  const cor = tom === 'alerta' ? 'text-amber-800' : tom === 'ok' ? 'text-green-800' : 'text-gray-900'
  return (
    <div className={`rounded-lg border p-4 ${borda}`}>
      <div className="text-xs text-gray-500">{titulo}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${cor}`}>{valor}</div>
      {detalhe && <div className="mt-1 text-xs text-gray-500">{detalhe}</div>}
    </div>
  )
}

function Aba({
  ativa,
  onClick,
  children,
}: {
  ativa: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-1 pb-2 text-sm font-medium transition ${
        ativa
          ? 'border-gray-900 text-gray-900'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- Vendas de agora
function Vendas() {
  const [responsavel, setResponsavel] = useState('')
  const [busca, setBusca] = useState('')
  const [pagina, setPagina] = useState(1)
  const qc = useQueryClient()

  const { data: resumo } = useQuery({ queryKey: ['difal-resumo'], queryFn: () => difalApi.resumo() })
  const { data: lista, isLoading } = useQuery({
    queryKey: ['difal-notas', responsavel, busca, pagina],
    queryFn: () =>
      difalApi.listar({ responsavel: responsavel || undefined, busca: busca || undefined, pagina }),
  })
  // A importação roda no servidor em segundo plano; aqui só consultamos o andamento a cada 3 s
  const { data: importacao } = useQuery({
    queryKey: ['difal-importacao'],
    queryFn: () => difalApi.importarStatus(),
    refetchInterval: (q) => (q.state.data?.emAndamento ? 3000 : false),
  })
  const terminadaEm = importacao?.terminadaEm ?? null
  useEffect(() => {
    if (!terminadaEm) return
    qc.invalidateQueries({ queryKey: ['difal-notas'] })
    qc.invalidateQueries({ queryKey: ['difal-resumo'] })
    qc.invalidateQueries({ queryKey: ['difal-guias-pendentes'] })
  }, [terminadaEm, qc])
  const importar = useMutation({
    mutationFn: () => difalApi.importar(90),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['difal-importacao'] }),
  })
  const importando = importar.isPending || !!importacao?.emAndamento
  const resumoImportacao = importacao?.resultado
    ? importacao.resultado.map((r) => `${r.empresa}: ${r.gravadas} nova(s), ${r.atualizadas} atualizada(s), ${r.puladas} já completas, ${r.erros.length} erro(s)`).join(' · ')
    : null
  const errosImportacao = importacao?.resultado?.flatMap((r) => r.erros) ?? []

  const notas = lista?.notas ?? []
  const totalPaginas = lista ? Math.max(1, Math.ceil(lista.total / lista.porPagina)) : 1
  const ml = resumo?.porResponsavel.find((r) => r.responsavel === 'ML_PAGA')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          Notas emitidas nos últimos 90 dias, com o DIFAL calculado por NCM e estado.
        </p>
        <button
          onClick={() => importar.mutate()}
          disabled={importando}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {importando ? 'Buscando notas… (pode levar alguns minutos)' : 'Atualizar do Bling'}
        </button>
      </div>

      {(importar.isError || importacao?.erro) && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Não foi possível buscar as notas: {importacao?.erro ?? (importar.error as Error).message}
        </div>
      )}
      {!importando && resumoImportacao && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          <p>Última importação ({new Date(terminadaEm!).toLocaleString('pt-BR')}): {resumoImportacao}</p>
          {errosImportacao.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-red-700">
              {errosImportacao.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
              {errosImportacao.length > 5 && <li>… e mais {errosImportacao.length - 5}</li>}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Numero
          titulo="Guias que precisamos emitir"
          valor={brl(resumo?.aPagar.valor)}
          detalhe={`${resumo?.aPagar.notas ?? 0} nota(s) de balcão ou Loja Integrada`}
          tom={(resumo?.aPagar.valor ?? 0) > 0 ? 'alerta' : 'ok'}
        />
        <Numero
          titulo="O Mercado Livre recolhe"
          valor={brl(ml?.calculado)}
          detalhe={`${ml?.notas ?? 0} nota(s) · ele cobra de nós depois`}
        />
        <Numero
          titulo="Cobrança do ML diferente do calculado"
          valor={brl(resumo?.divergentes.valor)}
          detalhe={`${resumo?.divergentes.notas ?? 0} nota(s) para conferir`}
          tom={(resumo?.divergentes.notas ?? 0) > 0 ? 'alerta' : 'ok'}
        />
      </div>

      <GuiasPendentes />

      <LotesGnre />

      <FechamentoMensal />

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={responsavel}
          onChange={(e) => { setResponsavel(e.target.value); setPagina(1) }}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">Todas as notas</option>
          <option value="NOSSO">Só as que precisamos pagar</option>
          <option value="ML_PAGA">Só as do Mercado Livre</option>
          <option value="CLIENTE">Cliente é contribuinte</option>
          <option value="SEM_DIFAL">Sem DIFAL</option>
        </select>
        <input
          value={busca}
          onChange={(e) => { setBusca(e.target.value); setPagina(1) }}
          placeholder="Número da NF ou cliente"
          className="min-w-[200px] flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <span className="text-sm text-gray-500">{lista?.total ?? 0} notas</span>
      </div>

      {totalPaginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-gray-600">
          <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina <= 1} className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40">
            Anterior
          </button>
          <span>página {pagina} de {totalPaginas}</span>
          <button onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina >= totalPaginas} className="rounded border border-gray-300 px-2 py-1 disabled:opacity-40">
            Próxima
          </button>
        </div>
      )}

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
              <th className="px-3 py-2 text-left">Quem paga</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-500">
                  Carregando…
                </td>
              </tr>
            )}
            {!isLoading && notas.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center">
                  <p className="text-gray-600">Nenhuma nota importada ainda.</p>
                  <p className="mt-1 text-sm text-gray-500">
                    Clique em &ldquo;Atualizar do Bling&rdquo; para trazer as notas dos últimos 90 dias.
                  </p>
                </td>
              </tr>
            )}
            {notas.map((n: DifalNota) => {
              const r = RESPONSAVEL[n.responsavel]
              return (
                <tr key={n.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    {n.nfNumero}
                    <span className="ml-1 text-xs text-gray-400">{n.empresa}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{dataBr(n.emitidaEm)}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-gray-700" title={n.clienteNome}>
                    {n.clienteNome}
                    {n.clienteTemIe && <span className="ml-1 text-xs text-gray-400">IE</span>}
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
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${r.cor}`} title={r.ajuda}>
                      {r.texto}
                    </span>
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

// ------------------------------------------------------------- Guias a emitir (GNRE)
// entrega um arquivo vindo da API como download no navegador
function baixarArquivo(arquivo: Blob, nome: string) {
  const url = URL.createObjectURL(arquivo)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}

// Como pedimos a resposta como arquivo (blob), o erro em JSON do backend chega como texto.
async function erroDoLote(e: unknown): Promise<string> {
  const resp = (e as { response?: { data?: Blob } }).response
  if (resp?.data instanceof Blob) {
    try {
      return (JSON.parse(await resp.data.text()) as { erro?: string }).erro ?? 'erro desconhecido'
    } catch {
      return 'erro desconhecido'
    }
  }
  return (e as Error).message
}

function GuiasPendentes() {
  const qc = useQueryClient()
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set())
  const [aviso, setAviso] = useState<string | null>(null)
  const [erroTexto, setErroTexto] = useState<string | null>(null)
  const { data: guias = [], isLoading } = useQuery({
    queryKey: ['difal-guias-pendentes'],
    queryFn: difalApi.guiasPendentes,
  })

  const prontas = guias.filter((g) => g.pronta)
  const empresaEscolhida = guias.find((g) => escolhidas.has(g.id))?.empresa

  const gerar = useMutation({
    mutationFn: () => difalApi.gerarLote([...escolhidas]),
    onSuccess: (lote) => {
      baixarArquivo(lote.arquivo, lote.nome)
      setAviso(`Lote ${lote.loteId} gerado: ${lote.guias} guia(s), ${brl(lote.total)}. O arquivo foi baixado.`)
      setEscolhidas(new Set())
      qc.invalidateQueries({ queryKey: ['difal-guias-pendentes'] })
      qc.invalidateQueries({ queryKey: ['difal-notas'] })
    },
    onError: async (e) => setErroTexto(await erroDoLote(e)),
  })

  function alternar(g: DifalGuiaPendente) {
    setEscolhidas((atual) => {
      const novo = new Set(atual)
      if (novo.has(g.id)) novo.delete(g.id)
      else novo.add(g.id)
      return novo
    })
  }

  if (isLoading) return null
  if (guias.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        Nenhuma guia nossa pendente. Tudo o que saiu para fora do RS está sendo recolhido pelo Mercado Livre ou é do cliente.
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
        <div>
          <p className="font-medium text-amber-900">Guias de DIFAL que nós precisamos emitir</p>
          <p className="text-xs text-amber-800">
            {guias.length} nota(s) pendente(s) · {prontas.length} com todos os dados para a guia (GNRE).
            Um lote por empresa, até 50 guias.
          </p>
        </div>
        <button
          onClick={() => { setAviso(null); setErroTexto(null); gerar.mutate() }}
          disabled={escolhidas.size === 0 || gerar.isPending}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {gerar.isPending ? 'Montando lote…' : `Baixar lote GNRE (${escolhidas.size})`}
        </button>
      </div>
      {aviso && <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">{aviso}</div>}
      {erroTexto && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          Não deu para montar o lote: {erroTexto}
        </div>
      )}
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {guias.map((g) => {
            const bloqueada = !g.pronta || (empresaEscolhida !== undefined && g.empresa !== empresaEscolhida && !escolhidas.has(g.id))
            return (
              <tr key={g.id} className={g.pronta ? '' : 'bg-gray-50'}>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={escolhidas.has(g.id)}
                    disabled={bloqueada}
                    onChange={() => alternar(g)}
                    title={bloqueada && g.pronta ? 'Lote de uma empresa só' : undefined}
                  />
                </td>
                <td className="px-2 py-2 font-medium text-gray-900">
                  {g.nfNumero} <span className="text-xs text-gray-400">{g.empresa}</span>
                </td>
                <td className="px-2 py-2 text-gray-600">{dataBr(g.emitidaEm)}</td>
                <td className="px-2 py-2 text-gray-600">{g.clienteUf}</td>
                <td className="px-2 py-2 text-right tabular-nums font-medium">{brl(g.difalCalculado)}</td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {g.pronta ? <span className="text-emerald-700">pronta</span> : `falta: ${g.faltando.join('; ')}`}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------- Fechamento mensal: ML cobrou x calculamos
const TOLERANCIA_FECHAMENTO = 0.05 // até 5% de diferença é normal (arredondamentos, estornos)

function mesBr(aaaaMm: string) {
  const [ano, mes] = aaaaMm.split('-')
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${nomes[Number(mes) - 1]}/${ano}`
}

function FechamentoMensal() {
  const qc = useQueryClient()
  const { data: linhas = [] } = useQuery({ queryKey: ['difal-fechamento'], queryFn: difalApi.fechamentoMensal })
  const sincronizar = useMutation({
    mutationFn: difalApi.sincronizarCobrancasMl,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['difal-fechamento'] }),
  })
  const avisos = (sincronizar.data ?? []).filter((r) => r.erro)

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div>
          <p className="font-medium text-gray-900">Fechamento mensal: o que o Mercado Livre cobrou × o que calculamos</p>
          <p className="text-xs text-gray-500">
            Lançamentos CDIFAL da fatura do ML (sem número de pedido, por isso o fechamento é por mês).
            Verde até {TOLERANCIA_FECHAMENTO * 100}% de diferença.
          </p>
        </div>
        <button
          onClick={() => sincronizar.mutate()}
          disabled={sincronizar.isPending}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {sincronizar.isPending ? 'Buscando na fatura…' : 'Atualizar cobranças do ML'}
        </button>
      </div>
      {sincronizar.isError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          Não foi possível buscar a fatura: {(sincronizar.error as Error).message}
        </div>
      )}
      {avisos.map((a) => (
        <div key={a.empresa} className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {a.empresa}: {a.erro}
        </div>
      ))}
      {linhas.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-500">
          Nenhuma cobrança do ML importada ainda. Clique em &ldquo;Atualizar cobranças do ML&rdquo;.
        </p>
      ) : (
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Mês</th>
              <th className="px-2 py-2 text-left">Empresa</th>
              <th className="px-2 py-2 text-right">ML cobrou</th>
              <th className="px-2 py-2 text-right">Calculamos</th>
              <th className="px-2 py-2 text-right">Diferença</th>
              <th className="px-4 py-2 text-left">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map((l: DifalFechamentoMes) => {
              const base = Math.max(l.calculado, l.cobradoMl)
              const ok = base === 0 || Math.abs(l.diferenca) / base <= TOLERANCIA_FECHAMENTO
              const semDados = l.lancamentos === 0 || l.notas === 0
              return (
                <tr key={`${l.mes}-${l.empresa}`}>
                  <td className="px-4 py-2 font-medium text-gray-900">{mesBr(l.mes)}</td>
                  <td className="px-2 py-2 text-gray-600">{l.empresa}</td>
                  <td className="px-2 py-2 text-right tabular-nums" title={`${l.lancamentos} lançamento(s)`}>{brl(l.cobradoMl)}</td>
                  <td className="px-2 py-2 text-right tabular-nums" title={`${l.notas} nota(s)`}>{brl(l.calculado)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{brl(l.diferenca)}</td>
                  <td className="px-4 py-2">
                    {semDados ? (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                        {l.lancamentos === 0 ? 'ML ainda não cobrou' : 'sem notas importadas'}
                      </span>
                    ) : ok ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">fecha</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">conferir</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// --------------------------------------------------------------- Lotes GNRE gerados
function mensagemErro(e: unknown): string {
  const resp = (e as { response?: { data?: { erro?: string } } }).response
  return resp?.data?.erro ?? (e as Error).message
}

function LotesGnre() {
  const qc = useQueryClient()
  const [erro, setErro] = useState<string | null>(null)
  const { data: lotes = [] } = useQuery({ queryKey: ['difal-lotes'], queryFn: difalApi.lotes })
  const { data: portal } = useQuery({ queryKey: ['difal-portal-status'], queryFn: difalApi.portalStatus })
  const recarregar = () => qc.invalidateQueries({ queryKey: ['difal-lotes'] })

  const enviar = useMutation({ mutationFn: difalApi.enviarLote, onSuccess: recarregar, onError: (e) => setErro(mensagemErro(e)) })
  const consultar = useMutation({ mutationFn: difalApi.consultarLote, onSuccess: recarregar, onError: (e) => setErro(mensagemErro(e)) })
  const desfazer = useMutation({
    mutationFn: difalApi.desfazerLote,
    onSuccess: () => { recarregar(); qc.invalidateQueries({ queryKey: ['difal-guias-pendentes'] }) },
    onError: (e) => setErro(mensagemErro(e)),
  })
  const xml = useMutation({ mutationFn: difalApi.baixarXmlLote, onSuccess: (r) => baixarArquivo(r.arquivo, r.nome) })
  const pdf = useMutation({ mutationFn: difalApi.baixarPdfLote, onSuccess: (r) => baixarArquivo(r.arquivo, r.nome), onError: (e) => setErro(mensagemErro(e)) })

  if (lotes.length === 0) return null
  const ocupado = enviar.isPending || consultar.isPending || desfazer.isPending

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <p className="font-medium text-gray-900">Lotes GNRE gerados</p>
        {portal && (
          <span className="text-xs text-gray-500">
            Portal: <b>{portal.ambiente === 'producao' ? 'PRODUÇÃO' : 'homologação (testes)'}</b> · certificado AVIC{' '}
            {portal.empresas.AVIC ? 'ok' : 'não configurado'} · AGRO {portal.empresas.AGRO ? 'ok' : 'não configurado'}
          </span>
        )}
      </div>
      {erro && (
        <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          <span>{erro}</span>
          <button onClick={() => setErro(null)} className="text-xs underline">fechar</button>
        </div>
      )}
      <div className="divide-y divide-gray-100">
        {lotes.map((l: DifalLote) => {
          const podeEnviar = !l.numeroRecibo && !!portal?.empresas[l.empresa as 'AVIC' | 'AGRO']
          return (
            <div key={l.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium text-gray-900">{l.id}</span>
                <span className="text-gray-600">{l.guias} guia(s) · {brl(l.total)} · gerado em {dataBr(l.criadoEm)}</span>
                {l.ambiente === 'homologacao' && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">teste</span>
                )}
                {l.numeroRecibo ? (
                  <span className="text-gray-600">recibo {l.numeroRecibo} · {l.situacaoDescricao ?? 'aguardando consulta'}</span>
                ) : l.situacaoDescricao ? (
                  <span className="text-amber-700">{l.situacaoDescricao}</span>
                ) : (
                  <span className="text-gray-500">não enviado ao portal</span>
                )}
                <span className="ml-auto flex flex-wrap gap-2">
                  <button onClick={() => xml.mutate(l.id)} className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">XML</button>
                  {podeEnviar && (
                    <button
                      onClick={() => { setErro(null); enviar.mutate(l.id) }}
                      disabled={ocupado}
                      className="rounded bg-gray-900 px-2 py-1 text-xs text-white hover:bg-gray-800 disabled:opacity-50"
                    >
                      {enviar.isPending ? 'Enviando…' : 'Enviar ao portal'}
                    </button>
                  )}
                  {l.numeroRecibo && (
                    <button
                      onClick={() => { setErro(null); consultar.mutate(l.id) }}
                      disabled={ocupado}
                      className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
                    >
                      {consultar.isPending ? 'Consultando…' : 'Consultar resultado'}
                    </button>
                  )}
                  {!l.numeroRecibo && (
                    <button
                      onClick={() => { setErro(null); if (window.confirm(`Desfazer o lote ${l.id}? As notas voltam para a fila de guias pendentes.`)) desfazer.mutate(l.id) }}
                      disabled={ocupado}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      Desfazer
                    </button>
                  )}
                  {l.temPdf && (
                    <button onClick={() => pdf.mutate(l.id)} className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100">
                      PDF das guias
                    </button>
                  )}
                </span>
              </div>
              {l.guiasResultado.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-gray-600">
                  {l.guiasResultado.map((g, i) => (
                    <li key={i}>
                      <span className={g.situacaoGuia === '0' ? 'text-emerald-700' : 'text-red-700'}>{g.situacaoTexto}</span>
                      {' · '}{g.identificadorGuia ?? g.ufFavorecida}
                      {g.valorGNRE && <> · R$ {g.valorGNRE}</>}
                      {g.dataLimitePagamento && <> · pagar até {g.dataLimitePagamento}</>}
                      {g.linhaDigitavel && <> · linha digitável <code className="select-all">{g.linhaDigitavel}</code></>}
                      {g.motivos.map((m) => <span key={m.codigo} className="text-red-700"> · {m.codigo} {m.descricao}{m.campo ? ` (${m.campo})` : ''}</span>)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------- Configuração (alíquotas + receita GNRE)
function Configuracao() {
  const qc = useQueryClient()
  const [empresa, setEmpresa] = useState<'AVIC' | 'AGRO'>('AVIC')
  const [ufAberta, setUfAberta] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const { data: aliquotas = [] } = useQuery({ queryKey: ['difal-aliquotas'], queryFn: difalApi.aliquotas })
  const { data: portal } = useQuery({ queryKey: ['difal-portal-status'], queryFn: difalApi.portalStatus })
  const recarregar = () => qc.invalidateQueries({ queryKey: ['difal-aliquotas'] })

  const buscar = useMutation({
    mutationFn: (uf: string) => difalApi.portalConfigUf(uf, empresa),
    onError: (e) => setErro(mensagemErro(e)),
  })
  const salvar = useMutation({
    mutationFn: ({ uf, dados }: { uf: string; dados: { codigoReceitaGnre?: string; vencimentoRegra?: string } }) =>
      difalApi.atualizarAliquota(uf, dados),
    onSuccess: () => { recarregar(); setUfAberta(null); buscar.reset() },
    onError: (e) => setErro(mensagemErro(e)),
  })

  const certificadoOk = !!portal?.empresas[empresa]
  const semReceita = aliquotas.filter((a) => !a.codigoReceitaGnre).length

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <p className="font-medium text-gray-900">Portal GNRE</p>
        {portal ? (
          <ul className="mt-1 space-y-0.5 text-gray-600">
            <li>Ambiente: <b>{portal.ambiente === 'producao' ? 'PRODUÇÃO' : 'homologação (testes)'}</b> — {portal.host}</li>
            <li>Certificado AVIC: {portal.empresas.AVIC ? 'configurado' : 'não configurado (GNRE_PFX_ARQUIVO_AVIC ou GNRE_PFX_BASE64_AVIC + GNRE_PFX_SENHA_AVIC)'}</li>
            <li>Certificado AGRO: {portal.empresas.AGRO ? 'configurado' : 'não configurado (GNRE_PFX_ARQUIVO_AGRO ou GNRE_PFX_BASE64_AGRO + GNRE_PFX_SENHA_AGRO)'}</li>
          </ul>
        ) : (
          <p className="text-gray-500">carregando…</p>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div>
            <p className="font-medium text-gray-900">Código de receita GNRE por estado</p>
            <p className="text-xs text-gray-500">
              Cada UF publica o seu código no portal (serviço GnreConfigUF). Sem ele a guia não fica &ldquo;pronta&rdquo;.
              {semReceita > 0 && <> <b>{semReceita}</b> estado(s) ainda sem código.</>}
            </p>
          </div>
          <label className="text-sm text-gray-600">
            Consultar com o certificado da{' '}
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value as 'AVIC' | 'AGRO')} className="rounded border border-gray-300 px-2 py-1 text-sm">
              <option>AVIC</option>
              <option>AGRO</option>
            </select>
          </label>
        </div>
        {erro && (
          <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            <span>{erro}</span>
            <button onClick={() => setErro(null)} className="text-xs underline">fechar</button>
          </div>
        )}
        <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">UF</th>
              <th className="px-2 py-2 text-right">Interna</th>
              <th className="px-2 py-2 text-right">Interest.</th>
              <th className="px-2 py-2 text-left">Método</th>
              <th className="px-2 py-2 text-left">Receita GNRE</th>
              <th className="px-2 py-2 text-left">Vencimento</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {aliquotas.map((a: DifalAliquota) => (
              <Fragment key={a.uf}>
                <tr className={a.codigoReceitaGnre ? '' : 'bg-amber-50/40'}>
                  <td className="px-4 py-2 font-medium text-gray-900" title={a.nome}>{a.uf}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">{pct(a.aliquotaInterna)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">{pct(a.interestadual)}</td>
                  <td className="px-2 py-2 text-gray-600">{a.metodo}</td>
                  <td className="px-2 py-2 tabular-nums">{a.codigoReceitaGnre ?? <span className="text-amber-700">falta</span>}</td>
                  <td className="px-2 py-2">
                    <select
                      value={a.vencimentoRegra}
                      onChange={(e) => salvar.mutate({ uf: a.uf, dados: { vencimentoRegra: e.target.value } })}
                      className="rounded border border-gray-300 px-2 py-1 text-xs"
                    >
                      <option value="saida">na saída (por operação)</option>
                      <option value="dia15">dia 15 do mês seguinte</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => { setErro(null); setUfAberta(a.uf); buscar.mutate(a.uf) }}
                      disabled={!certificadoOk || buscar.isPending}
                      title={certificadoOk ? 'Consulta o portal GNRE' : `Certificado da ${empresa} não configurado`}
                      className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-40"
                    >
                      {buscar.isPending && ufAberta === a.uf ? 'Consultando…' : 'Buscar receitas no portal'}
                    </button>
                  </td>
                </tr>
                {ufAberta === a.uf && buscar.data && (
                  <tr>
                    <td colSpan={7} className="bg-gray-50 px-4 py-3">
                      <p className="mb-2 text-xs text-gray-600">
                        {buscar.data.receitas.length} receita(s) em {a.uf} ({buscar.data.situacao.descricao}). Escolha a de ICMS para consumidor final não contribuinte:
                      </p>
                      <ul className="space-y-1">
                        {buscar.data.receitas.map((r: DifalReceitaUf) => (
                          <li key={`${r.codigo}-${r.courier}`} className="flex flex-wrap items-center gap-2 text-xs">
                            <button
                              onClick={() => salvar.mutate({ uf: a.uf, dados: { codigoReceitaGnre: r.codigo } })}
                              className="rounded bg-gray-900 px-2 py-0.5 text-white hover:bg-gray-800"
                            >
                              usar {r.codigo}
                            </button>
                            <span className="text-gray-800">{r.descricao}</span>
                            {r.courier && <span className="text-gray-500">(courier)</span>}
                            <span className="text-gray-500">
                              {[
                                r.exigeDocumentoOrigem && 'exige nota de origem',
                                r.exigeDetalhamentoReceita && 'exige detalhamento',
                                r.exigeProduto && 'exige produto',
                                r.exigePeriodoReferencia && 'exige período',
                                r.exigeCamposAdicionais && `campos extras: ${r.camposAdicionais.map((c) => c.titulo).join(', ')}`,
                              ].filter(Boolean).join(' · ')}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <button onClick={() => { setUfAberta(null); buscar.reset() }} className="mt-2 text-xs text-gray-500 underline">fechar</button>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Histórico apurado
function Historico() {
  const [verNotas, setVerNotas] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['difal-historico'],
    queryFn: () => difalApi.historico(),
  })

  if (isLoading) return <p className="py-8 text-center text-gray-500">Carregando apuração…</p>
  if (!data) return <p className="py-8 text-center text-gray-500">Não foi possível carregar.</p>

  const h: DifalHistorico = data
  const maior = Math.max(...h.estados.map((e) => e.pctCobrado), 5)

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-900">
          Entre {dataBr(h.periodo.de)} e {dataBr(h.periodo.ate)} pagamos{' '}
          <b>{brl(h.resumo.aMais)}</b> a mais de DIFAL do que o devido. A causa: os anúncios
          estavam sem a regra de redução do Convênio 52/91, então o Mercado Livre calculou pela
          alíquota cheia. Apenas {h.resumo.guiasComReducao} das {h.resumo.guiasComparadas} guias
          aplicaram a redução.
        </p>
        <p className="mt-2 text-sm font-medium text-amber-900">
          Corrigido em 16/11/2026: 1.491 produtos ligados à regra certa nas duas empresas.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Numero titulo="Pago a mais" valor={brl(h.resumo.aMais)} detalhe="o que não precisávamos ter pago" tom="alerta" />
        <Numero titulo="DIFAL devido" valor={brl(h.resumo.devido)} detalhe={`pagamos ${brl(h.resumo.pago)}`} />
        <Numero titulo="Multa e juros" valor={brl(h.resumo.encargos)} detalhe="encargos por atraso" />
        <Numero
          titulo="Autuações do Piauí"
          valor={brl(h.resumo.autuacoes.valor)}
          detalhe={`${h.resumo.autuacoes.notas} guias (TVI) — fora da comparação`}
        />
      </div>

      <div>
        <h2 className="mb-1 text-base font-medium text-gray-900">Quanto cada estado cobrou</h2>
        <p className="mb-3 text-sm text-gray-600">
          A barra cinza é o que era devido. A diferença em âmbar é o que pagamos a mais.
        </p>
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
          {h.estados.map((e) => (
            <div key={e.uf}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-gray-900">
                  {e.estado}
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {e.notas} nota{e.notas === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="tabular-nums text-gray-600">
                  cobrou <b className="text-gray-900">{pct(e.pctCobrado)}</b> · devia{' '}
                  {pct(e.pctDevido)}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="relative h-5 flex-1 overflow-hidden rounded bg-gray-100">
                  <div
                    className="absolute inset-y-0 left-0 bg-amber-400"
                    style={{ width: `${Math.min((e.pctCobrado / maior) * 100, 100)}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-gray-400"
                    style={{ width: `${Math.min((e.pctDevido / maior) * 100, 100)}%` }}
                  />
                </div>
                <span className="w-28 text-right text-sm font-medium tabular-nums text-amber-700">
                  +{brl(e.aMais)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <button
          onClick={() => setVerNotas(!verNotas)}
          className="text-sm text-gray-600 underline hover:text-gray-900"
        >
          {verNotas ? 'Esconder' : 'Ver'} as {h.notas.length} notas auditadas
        </button>
        {verNotas && (
          <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">NF</th>
                  <th className="px-3 py-2 text-left">UF</th>
                  <th className="px-3 py-2 text-left">Emissão</th>
                  <th className="px-3 py-2 text-right">Produtos</th>
                  <th className="px-3 py-2 text-right">Pago</th>
                  <th className="px-3 py-2 text-right">Devido</th>
                  <th className="px-3 py-2 text-right">Diferença</th>
                  <th className="px-3 py-2 text-left">Guia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {h.notas.map((n) => (
                  <tr key={`${n.uf}-${n.nf}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {n.nf}
                      {n.autuacao && (
                        <span className="ml-1 rounded bg-gray-100 px-1 text-xs text-gray-600">
                          autuação
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{n.uf}</td>
                    <td className="px-3 py-2 text-gray-600">{dataBr(n.data)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{brl(n.base)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900">
                      {brl(n.difal_pago)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                      {brl(n.difal_devido)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        n.diferenca > 1 ? 'text-amber-700' : 'text-gray-500'
                      }`}
                    >
                      {n.diferenca > 0 ? '+' : ''}
                      {brl(n.diferenca)}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{n.guia}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="border-t border-gray-200 pt-4">
        <summary className="cursor-pointer text-sm text-gray-600">Como estes números foram apurados</summary>
        <div className="mt-3 max-w-3xl space-y-2 text-sm text-gray-600">
          <p>
            <b>A conta.</b> Para o NCM 8436 a carga total é de 5,6% (Convênio ICMS 52/91, Anexo II).
            A nota já sai do RS com base reduzida e ICMS de 7%, o que dá 4,1% recolhidos na origem.
            O DIFAL do destino é a diferença: 1,5%. Ceará, Mato Grosso e Pernambuco usam método
            próprio do fisco — no Ceará dá 3,64%.
          </p>
          <p>
            <b>Origem dos dados.</b> {h.resumo.guiasTotal} guias de DIFAL pagas e os XML das notas,
            exportados do Mercado Livre. Entram na comparação as {h.resumo.notas} notas em que todos
            os itens têm NCM 8436.
          </p>
          <p>
            <b>Fora da conta.</b> Multa e juros, que decorrem de atraso e não da base de cálculo; e
            as {h.resumo.autuacoes.notas} guias de autuação do Piauí (TVI), que são lançamento do
            fisco. Cinco guias do Tocantins não puderam ser lidas: o PDF não traz os valores em
            texto.
          </p>
          <p className="text-xs text-gray-500">Apurado em {dataBr(h.apuradoEm)}.</p>
        </div>
      </details>
    </div>
  )
}

export function DifalPage() {
  const [aba, setAba] = useState<'vendas' | 'historico' | 'config'>('vendas')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">DIFAL</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Diferencial de alíquota das vendas interestaduais. Produtos de NCM 8436 têm a redução do
          Convênio 52/91: a carga total é 5,6%, a origem recolhe 4,1% e sobra 1,5% para o destino.
        </p>
      </div>

      <div className="flex gap-5 border-b border-gray-200">
        <Aba ativa={aba === 'vendas'} onClick={() => setAba('vendas')}>
          Vendas
        </Aba>
        <Aba ativa={aba === 'historico'} onClick={() => setAba('historico')}>
          O que já pagamos
        </Aba>
        <Aba ativa={aba === 'config'} onClick={() => setAba('config')}>
          Configuração
        </Aba>
      </div>

      {aba === 'vendas' ? <Vendas /> : aba === 'config' ? <Configuracao /> : <Historico />}
    </div>
  )
}
