import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { difalApi } from '../lib/api'
import type {
  DifalHistorico, DifalGuiaPendente, DifalFechamentoMes,
  DifalLote, DifalAliquota, DifalReceitaUf, DifalItemNota, DifalCalculoDetalhe, DifalGuiaResultado,
} from '../lib/api'
import './difal.css'
import { StatusBadge } from '../components/ui/Badge'
import { OrderDetailModal } from '../components/orders/OrderDetailModal'
import { ordersApi } from '../lib/api'
import { formatBRL as brl, formatDate, formatDateTime } from '../lib/utils'
import type { Order } from '../types'

// Ícones simples desenhados aqui mesmo (sem biblioteca nova)
const ICONES = {
  documento: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15h6M9 11h2',
  ok: 'M20 6 9 17l-5-5',
  alerta: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  atualizar: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  busca: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4-4',
  cadeado: 'M5 11h14v10H5zM7 11V7a5 5 0 0 1 10 0v4',
  moedas: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  engrenagem: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
} as const

function Icone({ nome, className = 'h-5 w-5' }: { nome: keyof typeof ICONES; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONES[nome]} />
    </svg>
  )
}

// quadro com os itens da NF, aberto ao passar o mouse no número da nota
function ItensDaNota({ itens }: { itens: DifalItemNota[] | null | undefined }) {
  if (!itens) return <p className="text-xs text-slate-500">Itens não guardados para esta nota (nota anterior à importação dos itens).</p>
  if (itens.length === 0) return <p className="text-xs text-slate-500">A nota veio sem itens do Bling.</p>
  const total = itens.reduce((s, i) => s + (i.valorTotal ?? 0), 0)
  return (
    <table className="w-full text-xs">
      <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
        <tr><th className="py-1 pr-2">SKU</th><th className="py-1 pr-2">Descrição</th><th className="py-1 pr-2">NCM</th><th className="py-1 pr-2 text-right">Qtd</th><th className="py-1 pr-2 text-right">Valor</th><th className="py-1 text-right">Total</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {itens.map((i, k) => (
          <tr key={k}>
            <td className="py-1 pr-2 font-medium text-slate-800">{i.sku ?? '—'}</td>
            <td className="max-w-[260px] py-1 pr-2 text-slate-700">{i.descricao ?? '—'}</td>
            <td className="py-1 pr-2 text-slate-500">{i.ncm ?? '—'}</td>
            <td className="py-1 pr-2 text-right tabular-nums">{i.quantidade ?? '—'}{i.unidade ? ` ${i.unidade}` : ''}</td>
            <td className="py-1 pr-2 text-right tabular-nums">{i.valorUnitario != null ? brl(i.valorUnitario) : '—'}</td>
            <td className="py-1 text-right font-medium tabular-nums">{brl(i.valorTotal)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot><tr><td colSpan={5} className="pt-1.5 text-right text-slate-500">Total dos itens</td><td className="pt-1.5 text-right font-semibold tabular-nums">{brl(total)}</td></tr></tfoot>
    </table>
  )
}

// Tooltip com os itens: flutua em posição fixa na tela (as listas ficam em caixas que cortariam um tooltip comum)
function ComDica({ conteudo, largura = 640, altura = 260, children }: { conteudo: React.ReactNode; largura?: number; altura?: number; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  function abrir(e: React.MouseEvent<HTMLSpanElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    // abre embaixo; se não couber embaixo, abre em cima; e não passa da borda direita
    const embaixo = r.bottom + 8
    setPos({ x: Math.min(r.left, window.innerWidth - largura - 20), y: embaixo + altura > window.innerHeight ? Math.max(8, r.top - altura - 8) : embaixo })
  }
  return (
    <span onMouseEnter={abrir} onMouseLeave={() => setPos(null)}>
      {children}
      {pos && (
        <span
          style={{ left: Math.max(8, pos.x), top: pos.y, width: largura, maxHeight: altura }}
          className="difal-entrar pointer-events-none fixed z-50 block max-w-[90vw] overflow-hidden rounded-xl border border-slate-200 bg-white p-3 text-left font-normal shadow-xl"
        >
          {conteudo}
        </span>
      )}
    </span>
  )
}

function ComItens({ itens, children }: { itens?: DifalItemNota[] | null; children: React.ReactNode }) {
  return <ComDica conteudo={<ItensDaNota itens={itens} />}>{children}</ComDica>
}

const pctBr = (v: number | undefined) => `${(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`

// A conta do DIFAL explicada passo a passo, com os números gravados na importação (calculo.ts)
function CalculoDaNota({ d, total }: { d: DifalCalculoDetalhe | null | undefined; total: number }) {
  if (!d) return <p className="text-xs text-slate-500">Cálculo não guardado para esta nota.</p>
  if (d.erro) return <p className="text-xs text-rose-700">Não deu para calcular: {d.erro}</p>
  if (d.motivo) return <p className="text-xs text-slate-600">{d.motivo}</p>
  const com = d.comReducao
  const sem = d.semReducao
  const interna = (d.aliquotaInterna ?? 0) + (d.fcp ?? 0)
  const linha = 'flex justify-between gap-4'
  return (
    <div className="space-y-2.5 text-xs text-slate-700">
      <p className="text-sm font-semibold text-slate-900">Como chegamos em {brl(total)}</p>
      <p className="text-slate-500">
        {d.uf}: alíquota interna {pctBr(d.aliquotaInterna)}{d.fcp ? ` + fundo de pobreza ${pctBr(d.fcp)}` : ''}. Do RS para {d.uf} a nota sai com {pctBr(d.interestadual)} (interestadual).
        {d.valorNota !== undefined
          ? ` A base é o valor total da NF, ${brl(d.valorNota)}${d.freteRateado ? ` (com frete de ${brl(d.freteRateado)})` : ''}${d.ajusteNota ? `, já ${d.ajusteNota < 0 ? `com desconto de ${brl(-d.ajusteNota)}` : `com ${brl(d.ajusteNota)} de outras despesas/IPI`}` : ''}, dividida entre as partes na proporção dos produtos.`
          : d.freteRateado ? ` O frete de ${brl(d.freteRateado)} entra na base, dividido entre as partes na proporção dos produtos.` : ''}
      </p>
      {com && com.valor > 0 && (
        <div className="rounded-lg bg-slate-50 p-2.5">
          <p className="mb-1 font-medium text-slate-900">1. Itens NCM 8436 (com redução do Convênio 52/91)</p>
          <div className={linha}><span>{d.valorNota !== undefined ? 'Base (parte do valor da NF)' : 'Base (produtos + frete rateado)'}</span><span className="tabular-nums">{brl(com.valor)}</span></div>
          {com.metodo === 'prop' ? (
            <>
              <div className={linha}><span>Base reduzida: {brl(com.valor)} × (5,6% ÷ {pctBr(d.aliquotaInterna)})</span><span className="tabular-nums">{brl(com.baseReduzida)}</span></div>
              <div className={linha}><span>Diferença de alíquotas: {pctBr(d.aliquotaInterna)} − {pctBr(d.interestadual)}</span><span className="tabular-nums">{pctBr(com.diferencaAliquotas)}</span></div>
              <div className={`${linha} font-medium text-slate-900`}><span>{brl(com.baseReduzida)} × {pctBr(com.diferencaAliquotas)}</span><span className="tabular-nums">{brl(com.difal)}</span></div>
              <p className="mt-1 text-[11px] text-slate-500">Método do fisco de {d.uf}: base reduzida vezes a diferença de alíquotas.</p>
            </>
          ) : (
            <>
              <div className={linha}><span>Carga total do Convênio 52/91 − carga já recolhida no RS: {pctBr(com.cargaTotal)} − {pctBr(com.cargaOrigem)}</span><span className="tabular-nums">{pctBr(com.cargaDevida)}</span></div>
              <div className={`${linha} font-medium text-slate-900`}><span>{brl(com.valor)} × {pctBr(com.cargaDevida)}</span><span className="tabular-nums">{brl(com.difal)}</span></div>
              {!com.cargaDevida && <p className="mt-1 text-[11px] text-slate-500">A origem já recolheu toda a carga: não sobra DIFAL para estes itens.</p>}
            </>
          )}
        </div>
      )}
      {sem && sem.valor > 0 && (
        <div className="rounded-lg bg-slate-50 p-2.5">
          <p className="mb-1 font-medium text-slate-900">{com && com.valor > 0 ? '2. ' : ''}Demais itens (sem redução)</p>
          <div className={linha}><span>{d.valorNota !== undefined ? 'Base (parte do valor da NF)' : 'Base (produtos + frete rateado)'}</span><span className="tabular-nums">{brl(sem.valor)}</span></div>
          <div className={linha}><span>Alíquota cheia: {pctBr(interna)} − {pctBr(d.interestadual)}</span><span className="tabular-nums">{pctBr(sem.aliquotaCheia)}</span></div>
          <div className={`${linha} font-medium text-slate-900`}><span>{brl(sem.valor)} × {pctBr(sem.aliquotaCheia)}</span><span className="tabular-nums">{brl(sem.difal)}</span></div>
        </div>
      )}
      <div className={`${linha} border-t border-slate-200 pt-2 text-sm font-semibold text-slate-900`}>
        <span>DIFAL{com && com.valor > 0 && sem && sem.valor > 0 ? ' (1 + 2)' : ''}</span><span className="tabular-nums">{brl(total)}</span>
      </div>
    </div>
  )
}

// número da nota com o selo da empresa e, embaixo, o nome do cliente; os itens aparecem ao passar o mouse
function NotaCliente({ nf, empresa, cliente, itens }: { nf: string; empresa: string; cliente: string; itens?: DifalItemNota[] | null }) {
  return (
    <span className="flex flex-col">
      <ComItens itens={itens}>
        <span className="w-fit cursor-help whitespace-nowrap font-medium text-slate-900 underline decoration-dotted decoration-slate-300 underline-offset-4">NF {nf} <SeloEmpresa empresa={empresa} /></span>
      </ComItens>
      <span className="max-w-[220px] truncate text-xs font-normal text-slate-500" title={cliente}>{cliente}</span>
    </span>
  )
}

// selo da empresa (AVIC / AGRO)
function SeloEmpresa({ empresa }: { empresa: string }) {
  const cor = empresa === 'AGRO' ? 'bg-violet-50 text-violet-700' : 'bg-sky-50 text-sky-700'
  return <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${cor}`}>{empresa}</span>
}

/**
 * Tipo de documento de origem que a UF aceita para a receita, na ordem que temos o dado:
 * 10 = número da nota; 22 = chave da NF-e; 24 = chave do DF-e (as duas últimas usam a chave de 44 dígitos).
 */
function tipoDocPreferido(r: DifalReceitaUf): string | undefined {
  if (!r.exigeDocumentoOrigem) return '' // a UF não exige: a guia vai sem documento de origem
  const aceitos = r.tiposDocumentosOrigem.map((t) => t.codigo)
  // se a UF só aceita tipos que o sistema não preenche (ex.: 23 CT-e), grava o primeiro: a nota fica "falta"
  return ['10', '22', '24'].find((t) => aceitos.includes(t)) ?? aceitos[0]
}

// busca da lista: sem diferença de acento nem maiúscula; todas as palavras digitadas precisam aparecer
const semAcento = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
function bateBusca(busca: string, g: { empresa: string; nfNumero: string; clienteNome: string; clienteUf: string; canal: string | null; mlLogistica: string | null; mlOrderId: string | null; itens: DifalItemNota[] | null }, extra: (string | null | undefined)[] = []) {
  if (!busca.trim()) return true
  const texto = semAcento([g.empresa, g.nfNumero, g.clienteNome, g.clienteUf, g.canal ?? 'Balcão', g.mlLogistica, g.mlOrderId,
    ...(g.itens ?? []).flatMap((i) => [i.sku, i.descricao]), ...extra].filter(Boolean).join(' '))
  return semAcento(busca).split(/\s+/).filter(Boolean).every((palavra) => texto.includes(palavra))
}

/** nome do canal como aparece na tela (nota sem loja = balcão) */
const nomeCanal = (canal: string | null) => canal ?? 'Balcão'

/** escolha de canal: só os canais que existem na lista; '' = todos */
function FiltroCanal({ canais, valor, onTrocar }: { canais: (string | null)[]; valor: string; onTrocar: (c: string) => void }) {
  const opcoes = [...new Set(canais.map(nomeCanal))].sort()
  return (
    <select value={valor} onChange={(e) => onTrocar(e.target.value)}
      className="max-w-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-blue-100">
      <option value="">Todos os canais</option>
      {opcoes.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  )
}

const CAMPO_BUSCA = 'w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-blue-100'
const DICA_BUSCA = 'Buscar NF, cliente, empresa, UF, canal, produto…'

function pct(v: number | null | undefined) {
  return `${(v ?? 0).toFixed(2).replace('.', ',')}%`
}

function dataBr(iso: string) {
  // A data da nota é um dia de calendário, não um instante. Lendo como UTC e
  // formatando em UTC, nota emitida de madrugada não aparece no dia anterior.
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

function Numero({
  titulo,
  valor,
  detalhe,
  tom = 'normal',
  icone,
}: {
  titulo: string
  valor: string
  detalhe?: string
  tom?: 'normal' | 'alerta' | 'ok'
  icone?: keyof typeof ICONES
}) {
  const borda = tom === 'alerta' ? 'border-amber-200 difal-kpi-alerta' : tom === 'ok' ? 'border-emerald-200 difal-kpi-ok' : 'border-indigo-100 difal-kpi-normal'
  const cor = tom === 'alerta' ? 'text-amber-700' : tom === 'ok' ? 'text-emerald-700' : 'text-slate-900'
  const fundoIcone = tom === 'alerta' ? 'bg-amber-50 text-amber-600' : tom === 'ok' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
  return (
    <div className={`difal-cartao difal-kpi flex items-center gap-3 rounded-xl border px-4 py-2.5 ${borda}`}>
      {icone && <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${fundoIcone}`}><Icone nome={icone} className="h-4 w-4" /></span>}
      <div className="min-w-0">
        <div className="text-xs text-slate-500">{titulo}</div>
        <div className={`text-xl font-semibold leading-tight tracking-tight tabular-nums ${cor}`}>{valor}</div>
        {detalhe && <div className="truncate text-[11px] text-slate-500" title={detalhe}>{detalhe}</div>}
      </div>
    </div>
  )
}

type NomeAba = 'vendas' | 'lotes' | 'historico' | 'fechamento' | 'config'
const ABAS: { id: NomeAba; texto: string }[] = [
  { id: 'vendas', texto: 'Vendas' },
  { id: 'lotes', texto: 'Lotes GNRE' },
  { id: 'historico', texto: 'O que já pagamos' },
  { id: 'fechamento', texto: 'Fechamento ML' },
]

// seletor de abas com um fundo escuro que desliza até a aba escolhida
function Abas({ aba, onTrocar }: { aba: NomeAba; onTrocar: (a: NomeAba) => void }) {
  // lotes esperando ação: ainda não enviados ao portal, ou enviados sem o resultado consultado
  const { data: lotes = [] } = useQuery({ queryKey: ['difal-lotes'], queryFn: difalApi.lotes })
  const lotesPendentes = lotes.filter((l) => !l.numeroRecibo || l.guiasResultado.length === 0).length
  const botoes = useRef<Partial<Record<NomeAba, HTMLButtonElement | null>>>({})
  const [indicador, setIndicador] = useState({ esquerda: 0, largura: 0 })
  useLayoutEffect(() => {
    const b = botoes.current[aba]
    // na configuração (engrenagem) nenhuma aba fica marcada
    setIndicador(b ? { esquerda: b.offsetLeft, largura: b.offsetWidth } : { esquerda: 0, largura: 0 })
  }, [aba])
  return (
    <div className="relative inline-flex rounded-xl bg-white/80 p-1 shadow-sm ring-1 ring-indigo-100 backdrop-blur">
      <span
        className="difal-indicador absolute bottom-1 top-1 left-0 rounded-lg bg-gradient-to-r from-indigo-600 to-sky-500 shadow-md shadow-indigo-500/30"
        style={{ width: indicador.largura, transform: `translateX(${indicador.esquerda}px)` }}
      />
      {ABAS.map((a) => (
        <button
          key={a.id}
          ref={(el) => { botoes.current[a.id] = el }}
          onClick={() => onTrocar(a.id)}
          className={`relative z-10 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            aba === a.id ? 'text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          {a.texto}
          {a.id === 'lotes' && lotesPendentes > 0 && (
            <span className="ml-2 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold text-white" title="lotes esperando envio ou consulta">{lotesPendentes}</span>
          )}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Vendas de agora
function Vendas({ lugarCards }: { lugarCards: HTMLElement | null }) {
  const qc = useQueryClient()

  // A importação roda no servidor em segundo plano; aqui só consultamos o andamento a cada 3 s
  const { data: importacao } = useQuery({
    queryKey: ['difal-importacao'],
    queryFn: () => difalApi.importarStatus(),
    refetchInterval: (q) => (q.state.data?.emAndamento ? 3000 : false),
  })
  const terminadaEm = importacao?.terminadaEm ?? null
  // Recarrega as listas só na passagem "importando → terminou" (não a cada vez que a página abre)
  const estavaImportando = useRef(false)
  const emAndamento = !!importacao?.emAndamento
  useEffect(() => {
    if (estavaImportando.current && !emAndamento) {
      qc.invalidateQueries({ queryKey: ['difal-resumo'] })
      qc.invalidateQueries({ queryKey: ['difal-guias-pendentes'] })
    }
    estavaImportando.current = emAndamento
  }, [emAndamento, qc])
  const importar = useMutation({
    mutationFn: () => difalApi.importar(90),
    // também no erro: se outra aba já está importando (409), esta passa a acompanhar
    onSettled: () => qc.invalidateQueries({ queryKey: ['difal-importacao'] }),
  })
  const erroDoClique = (importar.error as { response?: { data?: { erro?: string } }; message?: string } | null)
  const importando = importar.isPending || !!importacao?.emAndamento
  const resumoImportacao = importacao?.resultado
    ? importacao.resultado.map((r) => `${r.empresa}: ${r.gravadas} nova(s), ${r.atualizadas} atualizada(s), ${r.puladas} já completas, ${r.erros.length} erro(s)`).join(' · ')
    : null
  const errosImportacao = importacao?.resultado?.flatMap((r) => r.erros) ?? []


  // botão do Bling vai para a barra de filtros; o resumo da última importação fica na dica dele
  const botaoBling = (
    <button
      onClick={() => importar.mutate()}
      disabled={importando}
      title={`Atualizar do Bling: busca as notas dos últimos 90 dias e calcula o DIFAL por NCM e estado (só leitura no Bling).${
        !importando && resumoImportacao ? `\nÚltima importação (${formatDateTime(terminadaEm)}): ${resumoImportacao}` : ''}`}
      aria-label="Atualizar do Bling"
      className="difal-btn ml-auto inline-flex h-9 items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-500 px-2.5 text-sm font-medium text-white shadow-md shadow-indigo-500/30 hover:from-indigo-500 hover:to-sky-400 disabled:opacity-60"
    >
      <Icone nome="atualizar" className={`h-4 w-4 ${importando ? 'animate-spin' : ''}`} />
      {importando && <span>Buscando notas…</span>}
    </button>
  )

  return (
    <div className="space-y-3">
      {(importar.isError || importacao?.erro) && (
        <div className="difal-entrar rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Não foi possível buscar as notas: {importacao?.erro ?? erroDoClique?.response?.data?.erro ?? erroDoClique?.message}
        </div>
      )}
      {/* erro de importação nunca fica escondido: só o resumo de sucesso vai para a dica do botão */}
      {!importando && errosImportacao.length > 0 && (
        <div className="difal-entrar rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Última importação com {errosImportacao.length} erro(s): {errosImportacao.slice(0, 3).join(' · ')}{errosImportacao.length > 3 ? ' …' : ''}
        </div>
      )}

      <GuiasPendentes lugarCards={lugarCards} acaoExtra={botaoBling} />



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

function GuiasPendentes({ lugarCards, acaoExtra }: { lugarCards: HTMLElement | null; acaoExtra: React.ReactNode }) {
  const qc = useQueryClient()
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set())
  const [aviso, setAviso] = useState<string | null>(null)
  const [erroTexto, setErroTexto] = useState<string | null>(null)
  const { data: guias = [], isLoading } = useQuery({
    queryKey: ['difal-guias-pendentes'],
    queryFn: difalApi.guiasPendentes,
  })

  // divergências do ML (card do topo) vêm do resumo do servidor
  const { data: resumo } = useQuery({ queryKey: ['difal-resumo'], queryFn: () => difalApi.resumo() })
  // por padrão só os estados em que já tivemos cobrança de DIFAL; os outros o José confere com a contabilidade
  const [soComCobranca, setSoComCobranca] = useState(true)
  // filtro de datas de emissão (vale para as listas e para a planilha); padrão: tudo
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [busca, setBusca] = useState('')
  const [canal, setCanal] = useState('')
  // a data da nota é o dia de calendário gravado (Brasília como UTC): os 10 primeiros caracteres
  const noPeriodo = (g: DifalGuiaPendente) => (!de || g.emitidaEm.slice(0, 10) >= de) && (!ate || g.emitidaEm.slice(0, 10) <= ate)
  const semFiltroDeEstado = guias.filter(noPeriodo)
    .filter((g) => bateBusca(busca, g, [g.envio?.transportadora]))
    .filter((g) => !canal || nomeCanal(g.canal) === canal)
  const filtradas = soComCobranca ? semFiltroDeEstado.filter((g) => g.estadoComCobranca) : semFiltroDeEstado
  // nota marcada continua na tela mesmo que a busca/filtros não a mostrassem: dá para buscar uma por uma e ir
  // marcando, e o lote (que leva só as marcadas visíveis) nunca leva nota escondida
  const visiveis = escolhidas.size ? guias.filter((g) => escolhidas.has(g.id) || filtradas.includes(g)) : filtradas
  // só as escondidas pelo filtro de estado (o aviso diz "de outros estados")
  const escondidas = semFiltroDeEstado.length - filtradas.length
  const ufsComCobranca = [...new Set(guias.filter((g) => g.estadoComCobranca).map((g) => g.clienteUf))].sort().join(', ')
  // no prazo: entram em lote GNRE; atrasadas: vão para a contabilidade (sairiam sem multa e juros)
  const noPrazo = visiveis.filter((g) => !g.atrasada)
  // cards do topo: o que ainda não tem guia na lista filtrada (no prazo e atrasadas)
  const aEmitir = visiveis.filter((g) => !g.guiaGeradaEm)
  const difalAEmitir = aEmitir.reduce((s, g) => s + g.difalCalculado, 0)
  const valorNotasAEmitir = aEmitir.reduce((s, g) => s + g.valorNota, 0)
  const atrasadas = visiveis.filter((g) => g.atrasada)
  // seletor no topo: a mesma tabela mostra as do prazo ou as atrasadas
  const [lista, setLista] = useState<'prazo' | 'atrasadas'>('prazo')
  const verAtrasadas = lista === 'atrasadas'
  const mostradas = verAtrasadas ? atrasadas : noPrazo
  const prontas = mostradas.filter((g) => g.pronta)
  // o lote leva só as marcadas que estão na tela: busca, datas ou estado não podem esconder uma nota que vai para a guia
  const marcadas = mostradas.filter((g) => escolhidas.has(g.id)).map((g) => g.id)
  // quanto vai sair nas guias marcadas (aparece no botão do lote)
  const totalMarcado = mostradas.filter((g) => escolhidas.has(g.id)).reduce((s, g) => s + g.difalCalculado, 0)
  function trocarLista(nova: 'prazo' | 'atrasadas') {
    setLista(nova)
    setEscolhidas(new Set()) // não mistura no lote o que foi marcado na outra lista
  }
  // marcar em lote: todas as prontas visíveis de UMA empresa (o portal aceita lote de uma empresa só), até o limite
  function marcarEmpresa(empresa: string) {
    setEscolhidas(new Set(prontas.filter((g) => g.empresa === empresa).slice(0, LIMITE_GUIAS_LOTE).map((g) => g.id)))
  }
  const prontasPorEmpresa = (empresa: string) => prontas.filter((g) => g.empresa === empresa).length
  // atrasada sai só com o imposto: o José confirma antes de gerar (decisão de 20/11/2026)
  function gerarComAviso() {
    const atrasadasEscolhidas = mostradas.filter((g) => marcadas.includes(g.id) && g.atrasada).length
    if (atrasadasEscolhidas > 0 && !window.confirm(
      `${atrasadasEscolhidas} guia(s) atrasada(s): vão sair só com o imposto, SEM multa e juros. O estado pode cobrar a diferença depois. Gerar mesmo assim?`
    )) return
    setAviso(null)
    setErroTexto(null)
    gerar.mutate()
  }
  const empresaEscolhida = guias.find((g) => escolhidas.has(g.id))?.empresa

  const gerar = useMutation({
    mutationFn: () => difalApi.gerarLote(marcadas),
    onSuccess: (lote) => {
      baixarArquivo(lote.arquivo, lote.nome)
      setAviso(`Lote ${lote.loteId} gerado: ${lote.guias} guia(s), ${brl(lote.total)}. Envie ao portal na aba "Lotes GNRE".`)
      setEscolhidas(new Set())
      qc.invalidateQueries({ queryKey: ['difal-guias-pendentes'] })
      qc.invalidateQueries({ queryKey: ['difal-resumo'] })
      qc.invalidateQueries({ queryKey: ['difal-lotes'] })
    },
    onError: async (e) => setErroTexto(`Não deu para montar o lote: ${await erroDoLote(e)}`),
  })

  const marcar = useMutation({
    mutationFn: difalApi.marcarComprovanteMl,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['difal-guias-pendentes'] }); qc.invalidateQueries({ queryKey: ['difal-fechamento'] }) },
    onError: (e) => setErroTexto(`Comprovante: ${mensagemErro(e)}`),
  })

  function alternar(g: DifalGuiaPendente) {
    setEscolhidas((atual) => {
      const novo = new Set(atual)
      if (novo.has(g.id)) novo.delete(g.id)
      else novo.add(g.id)
      return novo
    })
  }

  if (isLoading) return <div className="flex">{acaoExtra}</div>

  // os cards seguem os filtros desta lista, mas aparecem no topo da página, acima das abas
  const cards = (
      <div className="difal-escalonado grid gap-3 sm:grid-cols-3">
        <Numero
          icone="documento"
          titulo="Guias que precisamos emitir"
          valor={brl(difalAEmitir)}
          detalhe={`${aEmitir.length} nota(s) sem guia nesta lista (no prazo e atrasadas, com os filtros abaixo)`}
          tom={difalAEmitir > 0 ? 'alerta' : 'ok'}
        />
        <Numero
          icone="moedas"
          titulo="Valor total dessas notas"
          valor={brl(valorNotasAEmitir)}
          detalhe={valorNotasAEmitir ? `DIFAL médio: ${pct((difalAEmitir / valorNotasAEmitir) * 100)} do valor das notas` : 'sem notas para pagar'}
        />
        <Numero
          icone={(resumo?.divergentes.notas ?? 0) > 0 ? 'alerta' : 'ok'}
          titulo="Cobrança do ML diferente do calculado"
          valor={brl(resumo?.divergentes.valor)}
          detalhe={`${resumo?.divergentes.notas ?? 0} nota(s) para conferir (todas, sem filtro)`}
          tom={(resumo?.divergentes.notas ?? 0) > 0 ? 'alerta' : 'ok'}
        />
      </div>
  )

  return (
    <>
    {lugarCards && createPortal(cards, lugarCards)}
    <div className="flex flex-wrap items-center gap-2">
    <div className="inline-flex rounded-xl bg-slate-100 p-1 text-sm">
        <button onClick={() => trocarLista('prazo')}
          className={`rounded-lg px-2.5 py-1 transition-colors ${lista === 'prazo' ? 'bg-white font-semibold text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
          No prazo <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums">{noPrazo.length}</span>
        </button>
        <button onClick={() => trocarLista('atrasadas')}
          className={`rounded-lg px-2.5 py-1 transition-colors ${lista === 'atrasadas' ? 'bg-white font-semibold text-rose-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
          Atrasadas <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums">{atrasadas.length}</span>
        </button>
    </div>
    <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={DICA_BUSCA} className={CAMPO_BUSCA} />
    <FiltroCanal canais={guias.map((g) => g.canal)} valor={canal} onTrocar={(c) => { setCanal(c); setEscolhidas(new Set()) }} />
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700">
      <span title="data de emissão da NF">De</span>
      <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="w-[8.5rem] rounded-lg border border-slate-200 px-1.5 py-0.5 text-sm outline-none focus:ring-4 focus:ring-blue-100" />
      <span>até</span>
      <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="w-[8.5rem] rounded-lg border border-slate-200 px-1.5 py-0.5 text-sm outline-none focus:ring-4 focus:ring-blue-100" />
      <span className="ml-1 inline-flex rounded-lg bg-slate-100 p-0.5 text-xs">
        {atalhosPeriodo().map(([rotulo, d, a]) => (
          <button key={rotulo} onClick={() => { setDe(d); setAte(a) }}
            className={`rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${de === d && ate === a ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            {rotulo}
          </button>
        ))}
      </span>
    </div>
    <label title={`${ufsComCobranca ? `Estados com cobrança: ${ufsComCobranca}.` : ''}${soComCobranca && escondidas ? ` ${escondidas} nota(s) de outros estados ocultas.` : ''}`}
      className="flex w-fit cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
      <input type="checkbox" checked={soComCobranca} onChange={(e) => setSoComCobranca(e.target.checked)} className="h-4 w-4 accent-blue-600" />
      <span>
        Estados c/ cobrança
      </span>
    </label>
    {acaoExtra}
    </div>
    {aviso && <div className="difal-entrar rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm text-emerald-900">{aviso}</div>}
    {erroTexto && <div className="difal-entrar rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-sm text-red-800">{erroTexto}</div>}
    {mostradas.length === 0 ? (
      <div className="difal-entrar flex items-center gap-3 rounded-2xl border border-emerald-200 bg-white p-4 text-sm text-emerald-900">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Icone nome="ok" className="h-4 w-4" /></span>
        {verAtrasadas ? 'Nenhuma nota atrasada neste filtro.' : 'Nenhuma guia no prazo para emitir agora.'}
      </div>
    ) : (
    <div className={`difal-secao ${verAtrasadas ? 'difal-secao-rosa border-rose-200' : 'difal-secao-azul border-slate-200'} overflow-hidden rounded-2xl border bg-white shadow-sm`}>
      <div className={`${verAtrasadas ? 'difal-cab-rosa' : 'difal-cab-azul'} flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4`}>
        <div>
          {verAtrasadas ? (
            <>
              <p className="text-base font-semibold text-slate-900">Atrasadas: passaram do prazo</p>
              <p className="text-xs text-slate-500">
                {atrasadas.length} nota(s) · {brl(atrasadas.reduce((s, g) => s + g.difalCalculado, 0))} de DIFAL. Dá para gerar a guia, mas ela sai só com o imposto,{' '}
                <b className="text-rose-700">sem multa e juros</b>. A planilha vai para a contabilidade.
              </p>
            </>
          ) : (
            <>
              <p className="text-base font-semibold text-slate-900">Guias para emitir agora (no prazo)</p>
              <p className="text-xs text-slate-500">
                {noPrazo.length} nota(s) no prazo · {prontas.length} prontas para a guia (GNRE). Um lote por empresa, até {LIMITE_GUIAS_LOTE} guias.
                Vendas do Mercado Livre: depois de pagar, anexe o comprovante na venda do ML e clique em "Comprovante enviado".
              </p>
            </>
          )}
        </div>
        <span className="flex flex-wrap items-center gap-2">
        {['AVIC', 'AGRO'].map((emp) => prontasPorEmpresa(emp) > 0 && (
          <button key={emp} onClick={() => marcarEmpresa(emp)}
            className="difal-btn rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-300">
            Marcar {emp} ({Math.min(prontasPorEmpresa(emp), LIMITE_GUIAS_LOTE)})
          </button>
        ))}
        {marcadas.length > 0 && (
          <button onClick={() => setEscolhidas(new Set())} className="difal-btn rounded-xl px-3 py-2 text-sm text-slate-500 hover:text-slate-800">Limpar</button>
        )}
        {verAtrasadas && (
          <button onClick={() => baixarListaAtrasadas(atrasadas)} className="difal-btn rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700 hover:bg-rose-50">
            Baixar lista
          </button>
        )}
        <button
          onClick={gerarComAviso}
          disabled={marcadas.length === 0 || gerar.isPending}
          className={`difal-btn rounded-xl bg-gradient-to-r ${verAtrasadas ? 'from-rose-600 to-orange-500 shadow-rose-500/30' : 'from-indigo-600 to-violet-600 shadow-indigo-500/30 hover:from-indigo-500 hover:to-violet-500'} px-4 py-2 text-sm font-medium text-white shadow-md disabled:opacity-40`}
        >
          {gerar.isPending ? 'Montando lote…' : marcadas.length ? `Baixar lote GNRE (${marcadas.length} · ${brl(totalMarcado)})` : 'Baixar lote GNRE (0)'}
        </button>
        </span>
      </div>
      <table className="min-w-full text-sm">
        <thead className={`bg-gradient-to-r ${verAtrasadas ? 'from-rose-50 to-orange-50 text-rose-900/60' : 'from-indigo-50 to-sky-50 text-indigo-900/60'} text-left text-xs uppercase tracking-wide`}>
          <tr><th className="w-10 px-5 py-2"></th><th className="px-2 py-2">Nota / cliente</th><th className="px-2 py-2">Emissão</th><th className="px-2 py-2">{verAtrasadas ? 'Venceu em' : 'Prazo'}</th><th className="px-2 py-2">UF</th><th className="px-2 py-2">Canal</th><th className="px-2 py-2">Transportadora</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Envio</th><th className="px-2 py-2">Previsão</th><th className="px-2 py-2 text-right">Valor da NF</th><th className="px-2 py-2 text-right">DIFAL</th><th className="px-5 py-2">Situação</th></tr>
        </thead>
        <tbody className="difal-linhas divide-y divide-slate-100">
          {mostradas.map((g) => {
            const bloqueada = !g.pronta || (empresaEscolhida !== undefined && g.empresa !== empresaEscolhida && !escolhidas.has(g.id))
            return (
              <tr key={g.id} className={g.pronta || g.guiaGeradaEm ? '' : 'opacity-75'}>
                <td className="px-5 py-2.5">
                  {!g.guiaGeradaEm && <input
                    type="checkbox"
                    checked={escolhidas.has(g.id)}
                    disabled={bloqueada}
                    onChange={() => alternar(g)}
                    title={bloqueada && g.pronta ? 'Lote de uma empresa só' : undefined}
                    className="h-4 w-4 accent-blue-600"
                  />}
                </td>
                <td className="px-2 py-2.5">
                  <NotaCliente nf={g.nfNumero} empresa={g.empresa} cliente={g.clienteNome} itens={g.itens} />
                </td>
                <td className="px-2 py-2.5 text-slate-500">{dataBr(g.emitidaEm)}</td>
                <td className={`px-2 py-2.5 text-xs ${g.atrasada ? 'font-medium text-rose-700' : 'text-slate-500'}`}>{g.atrasada ? `venceu ${dataBr(g.prazo)}` : g.prazo === isoDia(new Date()) ? 'pagar hoje' : `vence ${dataBr(g.prazo)}`}</td>
                <td className="px-2 py-2.5"><span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">{g.clienteUf}</span></td>
                <CelulaCanal g={g} />
                <CelulasEnvio envio={g.envio} envioMl={g.envioMl} />
                <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{brl(g.valorNota)}</td>
                <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-indigo-700">
                  <ComDica largura={460} altura={340} conteudo={<CalculoDaNota d={g.calculoDetalhe} total={g.difalCalculado} />}>
                    <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">{brl(g.difalCalculado)}</span>
                  </ComDica>
                </td>
                <td className="px-5 py-2.5 text-xs">
                  <span className="flex flex-wrap items-center gap-2">
                    {g.situacao === 'DIVERGENTE' ? (
                      <span title={g.observacao ?? undefined} className="rounded-full bg-rose-50 px-2.5 py-1 font-medium text-rose-700">● nota divergente (cancelada?) — conferir</span>
                    ) : g.guiaGeradaEm && ['1', '2'].includes(g.situacaoGuia ?? '') ? (
                      <span className="rounded-full bg-rose-50 px-2.5 py-1 font-medium text-rose-700">guia recusada · em Lotes GNRE, &ldquo;Devolver à fila&rdquo;</span>
                    ) : g.guiaGeradaEm && g.situacaoGuia === '3' ? (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-800">erro de comunicação com o estado · consulte o lote de novo; sem código de barras, &ldquo;Devolver à fila&rdquo;</span>
                    ) : g.guiaGeradaEm && !g.guiaAceita ? (
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-700">guia gerada · envie ao portal e consulte</span>
                    ) : g.guiaGeradaEm ? (
                      <>
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">guia aceita · pagar e anexar</span>
                        <button
                          onClick={() => { setErroTexto(null); if (window.confirm(`Confirma que o comprovante da NF ${g.nfNumero} foi anexado na venda do ML?`)) marcar.mutate(g.id) }}
                          disabled={marcar.isPending}
                          className="difal-btn rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Comprovante enviado
                        </button>
                      </>
                    ) : g.pronta ? (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">● pronta</span>
                    ) : (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 font-medium text-amber-700">● falta: {g.faltando.join('; ')}</span>
                    )}
                    {g.ml && g.mlOrderId && (
                      <a href={linkComprovanteMl(g.mlOrderId)} target="_blank" rel="noreferrer" title={`venda ML ${g.mlOrderId}`}
                        className="difal-btn rounded-lg border border-yellow-300 bg-yellow-50 px-2.5 py-1 font-medium text-yellow-800 hover:bg-yellow-100">
                        Comprovante no ML ↗
                      </a>
                    )}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
    )}
    </>
  )
}

// Tela "Envie o comprovante de pagamento do DIFAL" da venda no ML (endereço enviado pelo José em 20/11/2026)
function linkComprovanteMl(mlOrderId: string): string {
  return `https://vendedores.mercadolivre.com.br/emissor/informar-documento?orders_ids=${encodeURIComponent(mlOrderId)}`
}

function isoDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** atalhos do filtro de datas: [rótulo, de, até] ('' = sem limite) */
function atalhosPeriodo(): [string, string, string][] {
  const hoje = new Date()
  const menos = (dias: number) => isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - dias))
  const inicioMes = isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), 1))
  const inicioMesPassado = isoDia(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1))
  const fimMesPassado = isoDia(new Date(hoje.getFullYear(), hoje.getMonth(), 0))
  return [
    ['7 dias', menos(6), ''],
    ['30 dias', menos(29), ''],
    ['Este mês', inicioMes, ''],
    ['Mês passado', inicioMesPassado, fimMesPassado],
    ['Tudo', '', ''],
  ]
}

/** máximo de guias por lote: manual GNRE (o servidor usa LIMITE_GUIAS_POR_LOTE em gnre.ts com o mesmo valor) */
const LIMITE_GUIAS_LOTE = 50

// planilha das atrasadas para a contabilidade: só dados da nota, sem nome nem CPF do cliente (LGPD)
function baixarListaAtrasadas(notas: DifalGuiaPendente[]) {
  const linhas = [['Empresa', 'NF', 'Emissão', 'UF', 'Prazo', 'DIFAL (R$)', 'Envio', 'Transportadora', 'Entregue em'].join(';')].concat(
    notas.map((g) => [
      g.empresa, g.nfNumero, dataBr(g.emitidaEm), g.clienteUf, dataBr(g.prazo), g.difalCalculado.toFixed(2).replace('.', ','),
      envioTexto(g.envio), g.envio?.transportadora ?? '', g.envio?.entregueEm ? dataBr(g.envio.entregueEm) : '',
    ].map((v) => String(v).replace(/;/g, ',')).join(';'))
  )
  // BOM para o Excel abrir com acentos certos; ';' e vírgula decimal no padrão brasileiro
  const arquivo = new Blob(['\ufeff' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  baixarArquivo(arquivo, `difal-atrasadas-${new Date().toISOString().slice(0, 10)}.csv`)
}

// cores do selo do tipo de envio do ML
const COR_LOGISTICA: Record<string, string> = {
  FULL: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Coleta: 'bg-sky-50 text-sky-700 ring-sky-200',
  'A combinar': 'bg-amber-50 text-amber-700 ring-amber-200',
  ME1: 'bg-violet-50 text-violet-700 ring-violet-200',
}

// cor do selo da plataforma da venda
function corCanal(canal: string | null): string {
  const c = (canal ?? '').toLowerCase()
  if (c.includes('mercado livre')) return 'bg-yellow-50 text-yellow-800 ring-yellow-200'
  if (c.includes('loja integrada')) return 'bg-blue-50 text-blue-700 ring-blue-200'
  if (c.includes('shopee')) return 'bg-orange-50 text-orange-700 ring-orange-200'
  return 'bg-slate-100 text-slate-600 ring-slate-200'
}

// plataforma da venda e, no Mercado Livre, o tipo de envio
function CelulaCanal({ g }: { g: DifalGuiaPendente }) {
  return (
    <td className="px-2 py-2.5 text-xs">
      <span className="flex flex-col gap-1">
        <span className={`w-fit max-w-[150px] truncate rounded-md px-1.5 py-0.5 font-medium ring-1 ${corCanal(g.canal)}`} title={g.canal ?? undefined}>{g.canal ?? 'Balcão'}</span>
        {g.ml && (
          <span title={g.mlLogistica ? undefined : 'Buscado na API do Mercado Livre no "Atualizar do Bling" em produção (o PC não tem acesso à conta do ML)'}
            className={`w-fit rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${COR_LOGISTICA[g.mlLogistica ?? ''] ?? 'bg-slate-50 text-slate-400 ring-slate-200'}`}>
            {g.mlLogistica ?? 'tipo de envio: pendente'}
          </span>
        )}
      </span>
    </td>
  )
}

// Envio da nota como na tela de Pedidos: transportadora, status (mesmo selo), data de envio e previsão/entrega
// status do envio do Mercado Envios (API do ML) → texto e cor do selo
const STATUS_ENVIO_ML: Record<string, [string, string]> = {
  pending: ['Em preparação', 'bg-slate-100 text-slate-600'],
  handling: ['Em preparação', 'bg-slate-100 text-slate-600'],
  ready_to_ship: ['Pronto para enviar', 'bg-amber-50 text-amber-700'],
  shipped: ['A caminho', 'bg-sky-50 text-sky-700'],
  delivered: ['Entregue', 'bg-emerald-50 text-emerald-700'],
  not_delivered: ['Não entregue', 'bg-rose-50 text-rose-700'],
  cancelled: ['Cancelado', 'bg-slate-100 text-slate-500'],
}

function CelulasEnvio({ envio, envioMl }: { envio: DifalGuiaPendente['envio']; envioMl: DifalGuiaPendente['envioMl'] }) {
  // clicar no status abre a mesma janela 'Detalhes do Pedido' da tela de Pedidos
  const [pedido, setPedido] = useState<Order | null>(null)
  const [abrindo, setAbrindo] = useState(false)
  async function abrir(id: string) {
    setAbrindo(true)
    try {
      setPedido(await ordersApi.get(id))
    } finally {
      setAbrindo(false)
    }
  }
  if (!envio && envioMl?.status) {
    // venda pelo Mercado Envios: rastreio do próprio ML (status atual, sem o histórico de cada movimentação)
    const [texto, cor] = envioMl.substatus === 'out_for_delivery'
      ? ['Saiu para entrega', 'bg-sky-100 text-sky-800']
      : STATUS_ENVIO_ML[envioMl.status] ?? [envioMl.status, 'bg-slate-100 text-slate-600']
    const lido = envioMl.lidoEm ? `rastreio do ML · lido em ${formatDateTime(envioMl.lidoEm)}` : 'rastreio do ML'
    return (
      <>
        <td className="px-2 py-2.5 text-xs text-slate-600">
          Mercado Envios
          <span className="block text-[10px] text-slate-400">{lido}</span>
        </td>
        <td className="px-2 py-2.5"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${cor}`}>{texto}</span></td>
        <td className="px-2 py-2.5 text-xs text-slate-400">—</td>
        <td className="px-2 py-2.5 text-xs text-slate-600">{formatDate(envioMl.previsao)}</td>
      </>
    )
  }
  if (!envio) {
    return (
      <td colSpan={4} className="px-2 py-2.5 text-xs text-slate-400" title="Nota não está no order-tracker nem tem envio do ML lido (retirada, Shopee, venda do ML ainda não consultada…)">sem rastreio</td>
    )
  }
  return (
    <>
      <td className="max-w-[180px] truncate px-2 py-2.5 text-xs text-slate-600" title={envio.transportadora ?? undefined}>{envio.transportadora ?? '—'}</td>
      <td className="px-2 py-2.5">
        <button
          onClick={() => abrir(envio.pedidoId)}
          disabled={abrindo}
          title={`${envio.ultimoRastreio ?? ''}${envio.ultimoRastreio ? ' · ' : ''}clique para ver o pedido`}
          className="difal-btn rounded-full disabled:opacity-50"
        >
          <StatusBadge status={envio.situacao} hasOccurrence={envio.temOcorrencia} lastTracking={envio.ultimoRastreio} />
        </button>
        {pedido && <OrderDetailModal order={pedido} onClose={() => setPedido(null)} />}
      </td>
      <td className="px-2 py-2.5 text-xs text-slate-600">{envio.enviadoEm ? dataBr(envio.enviadoEm) : '—'}</td>
      <td className="px-2 py-2.5 text-xs text-slate-600">
        {envio.entregueEm ? <span className="text-emerald-700">entregue {dataBr(envio.entregueEm)}</span> : envio.previsao ? dataBr(envio.previsao) : '—'}
      </td>
    </>
  )
}

function envioTexto(e: DifalGuiaPendente['envio']): string {
  const rotulos: Record<string, string> = { PENDING: 'aguardando coleta', IN_TRANSIT: 'em trânsito', DELIVERED: 'entregue', CANCELLED: 'cancelado' }
  return e ? rotulos[e.situacao] ?? e.situacao : 'sem rastreio'
}

// ------------------------------------------------- Fechamento mensal: ML cobrou x calculamos

function mesBr(aaaaMm: string) {
  const [ano, mes] = aaaaMm.split('-')
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${nomes[Number(mes) - 1]}/${ano}`
}

function FechamentoMensal() {
  const qc = useQueryClient()
  const { data: linhas = [], isLoading, isError, error } = useQuery({ queryKey: ['difal-fechamento'], queryFn: difalApi.fechamentoMensal })
  const sincronizar = useMutation({
    mutationFn: difalApi.sincronizarCobrancasMl,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['difal-fechamento'] }),
  })
  const avisos = (sincronizar.data ?? []).filter((r) => r.erro)
  // importação histórica do Bling (uma vez): enche a coluna 'Nossa conta' dos meses antigos
  const { data: importacao } = useQuery({
    queryKey: ['difal-importacao'],
    queryFn: () => difalApi.importarStatus(),
    refetchInterval: (q) => (q.state.data?.emAndamento ? 5000 : false),
  })
  const importarHistorico = useMutation({
    // de 01/12/2025 até hoje (a rota aceita até 365 dias)
    mutationFn: () => difalApi.importar(Math.min(365, Math.ceil((Date.now() - new Date('2025-12-01T03:00:00Z').getTime()) / 86400000) + 1)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['difal-importacao'] }),
  })
  const importandoHistorico = importarHistorico.isPending || !!importacao?.emAndamento
  // quando a importação termina, o fechamento é recarregado (a coluna 'Nossa conta' se completa sozinha)
  const estavaImportando = useRef(false)
  useEffect(() => {
    if (estavaImportando.current && !importacao?.emAndamento) qc.invalidateQueries({ queryKey: ['difal-fechamento'] })
    estavaImportando.current = !!importacao?.emAndamento
  }, [importacao?.emAndamento, qc])

  return (
    <div className="difal-secao difal-secao-ciano overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="difal-cab-ciano flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-base font-semibold text-slate-900">Fechamento mensal: o que o Mercado Livre pagou e cobrou × o que era devido</p>
          <p className="text-xs text-gray-500">
            Todos os meses desde a primeira guia dos ZIPs de comprovantes do ML (AVIC e AGRO). Notas…Multa/juros: guias que o
            ML pagou (ZIPs). &ldquo;Fatura ML&rdquo;: lançamentos CDIFAL que ele cobrou de nós (mês da fatura). &ldquo;Nossa conta&rdquo;: o
            DIFAL certo de todas as vendas do ML do mês (mês da emissão). Passe o mouse nos títulos.
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          {/* a conta do ML já foi bloqueada: o dia a dia lê só 2 meses; os 12 meses ficam num botão à parte, para usar uma vez */}
          <button
            onClick={() => { if (window.confirm('Buscar no Bling as notas desde 01/12/2025 (só leitura)? São milhares de notas: roda em segundo plano e pode levar até 1 hora. Use uma vez, para completar a coluna \u201cNossa conta\u201d dos meses antigos. N\u00e3o use perto das 16h: a rotina di\u00e1ria importa no mesmo hor\u00e1rio.')) importarHistorico.mutate() }}
            disabled={importandoHistorico}
            className="difal-btn rounded-xl px-3 py-2 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            {importandoHistorico ? 'Importando notas do Bling…' : 'Importar notas desde dez/2025 (uma vez)'}
          </button>
          <button
            onClick={() => { if (window.confirm('Ler os 12 meses da fatura do ML? São bem mais chamadas à API; use só para completar o histórico.')) sincronizar.mutate(12) }}
            disabled={sincronizar.isPending}
            className="difal-btn rounded-xl px-3 py-2 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
          >
            Buscar 12 meses (uma vez)
          </button>
          <button
            onClick={() => sincronizar.mutate(2)}
            disabled={sincronizar.isPending}
            className="difal-btn rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:border-slate-300 disabled:opacity-50"
          >
            {sincronizar.isPending ? 'Buscando na fatura…' : 'Atualizar cobranças do ML'}
          </button>
        </span>
      </div>
      {isLoading && <p className="px-5 py-6 text-center text-sm text-slate-500">Carregando o fechamento…</p>}
      {isError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">Não foi possível carregar o fechamento: {mensagemErro(error)}</div>
      )}
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
      {/* o que a busca da fatura leu: deixa claro se o ML só tem esses meses ou se a busca parou no meio */}
      {sincronizar.data && (
        <div className="border-b border-sky-100 bg-sky-50 px-4 py-2 text-xs text-sky-900">
          Fatura do ML lida agora:{' '}
          {sincronizar.data.map((r) => `${r.empresa}: ${r.periodos.length} mês(es) (${r.periodos.map((p) => mesBr(p.slice(0, 7))).join(', ') || 'nenhum'}), ${r.cdifal} lançamento(s) CDIFAL${r.erro ? ' — parou com erro' : ''}`).join(' · ')}
        </div>
      )}
      {importacao?.emAndamento && (
        <div className="border-b border-indigo-100 bg-indigo-50 px-4 py-2 text-xs text-indigo-900">
          Importando notas do Bling em segundo plano… a coluna &ldquo;Nossa conta&rdquo; se completa quando terminar.
        </div>
      )}
      {!importacao?.emAndamento && importacao?.erro && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">Última importação do Bling falhou: {importacao.erro}</div>
      )}
      {importarHistorico.isError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">Não foi possível iniciar a importação: {mensagemErro(importarHistorico.error)}</div>
      )}
      {!isLoading && !isError && (() => {
        const tot = (k: 'guiasZip' | 'pagoZip' | 'devidoZip' | 'aMaisZip' | 'encargosZip') => linhas.reduce((s, l) => s + l[k], 0)
        return (
          <div className="grid gap-3 border-b border-slate-100 px-5 py-3 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-slate-500">ML pagou de DIFAL (guias dos ZIPs)</p><p className="text-lg font-semibold tabular-nums">{brl(tot('pagoZip'))}</p><p className="text-[11px] text-slate-400">{tot('guiasZip')} nota(s) com guia</p></div>
            <div><p className="text-xs text-slate-500">Devido pela nossa conta</p><p className="text-lg font-semibold tabular-nums">{brl(tot('devidoZip'))}</p></div>
            <div><p className="text-xs text-slate-500">Pago a mais</p><p className="text-lg font-semibold tabular-nums text-rose-700">{brl(tot('aMaisZip'))}</p></div>
            <div><p className="text-xs text-slate-500">Multa e juros</p><p className="text-lg font-semibold tabular-nums text-amber-700">{brl(tot('encargosZip'))}</p></div>
          </div>
        )
      })()}
      {!isLoading && !isError && <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2.5 text-left">Mês</th>
              <th className="px-2 py-2 text-left">Empresa</th>
              <th className="px-2 py-2 text-right" title="notas com guia de DIFAL paga pelo ML, lidas dos ZIPs de comprovantes (sem autuações); mês = emissão da NF">Notas</th>
              <th className="px-2 py-2 text-right" title="DIFAL principal que o ML pagou nas guias">ML pagou</th>
              <th className="px-2 py-2 text-right" title="o que era devido pela regra do NCM 8436 (1,5% ou método do estado)">Devido</th>
              <th className="px-2 py-2 text-right">Pago a mais</th>
              <th className="px-2 py-2 text-right" title="multa e juros pagos nessas guias">Multa/juros</th>
              <th className="px-2 py-2 text-right" title="lançamentos CDIFAL da fatura do ML (o que ele cobrou de nós)">Fatura ML</th>
              <th className="px-2 py-2 text-right" title="nosso cálculo do DIFAL em todas as vendas do ML do mês com DIFAL, importadas do Bling (base: valor da NF, regra do 8436)">Nossa conta (vendas ML)</th>
              <th className="px-4 py-2 text-right" title="fatura do ML (CDIFAL) menos a nossa conta: positivo = o ML cobrou mais do que devia">Fatura − nossa conta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {linhas.map((l: DifalFechamentoMes) => {
              const vazio = !l.guiasZip && !l.lancamentos && !l.notas
              const traco = <span className="text-slate-300">—</span>
              return (
                <tr key={`${l.mes}-${l.empresa}`} className={`transition-colors hover:bg-slate-50 ${vazio ? 'text-slate-400' : ''}`}>
                  <td className="px-5 py-2 font-medium text-slate-900">{mesBr(l.mes)}</td>
                  <td className="px-2 py-2"><SeloEmpresa empresa={l.empresa} /></td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.guiasZip || traco}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.guiasZip ? brl(l.pagoZip) : traco}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{l.guiasZip ? brl(l.devidoZip) : traco}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${l.aMaisZip > 0.01 ? 'font-medium text-rose-700' : ''}`}>{l.guiasZip ? brl(l.aMaisZip) : traco}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-amber-700">{l.guiasZip ? brl(l.encargosZip) : traco}</td>
                  <td className="px-2 py-2 text-right tabular-nums" title={`${l.lancamentos} lançamento(s) CDIFAL`}>{l.lancamentos ? brl(l.cobradoMl) : traco}</td>
                  <td className="px-2 py-2 text-right tabular-nums" title={`${l.notas} venda(s) do ML`}>{l.notas ? brl(l.calculado) : traco}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${l.lancamentos && l.notas && l.cobradoMl - l.calculado > 0.01 ? 'font-medium text-rose-700' : ''}`}>
                    {l.lancamentos && l.notas ? brl(l.cobradoMl - l.calculado) : traco}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>}
    </div>
  )
}

// --------------------------------------------------------------- Lotes GNRE gerados
function copiarPeloMetodoAntigo(texto: string): boolean {
  const campo = document.createElement('textarea')
  campo.value = texto
  campo.style.position = 'fixed'
  campo.style.opacity = '0'
  document.body.appendChild(campo)
  campo.select()
  const ok = document.execCommand('copy')
  campo.remove()
  return ok
}

// copia um texto (linha digitável ou PIX copia e cola) e mostra "copiado!" por 2 segundos
function BotaoCopiar({ texto, rotulo }: { texto: string; rotulo: string }) {
  const [estado, setEstado] = useState<'' | 'copiado' | 'erro'>('')
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setEstado('copiado')
    } catch {
      // alguns navegadores bloqueiam a área de transferência moderna: tenta o método antigo
      setEstado(copiarPeloMetodoAntigo(texto) ? 'copiado' : 'erro')
    }
    setTimeout(() => setEstado(''), 2000)
  }
  return (
    <button
      onClick={copiar}
      className={`difal-btn rounded-lg border px-3 py-1.5 text-xs font-medium ${
        estado === 'copiado' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : estado === 'erro' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
      }`}
    >
      {estado === 'copiado' ? 'copiado!' : estado === 'erro' ? 'não deu para copiar' : rotulo}
    </button>
  )
}

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
  const consultar = useMutation({
    mutationFn: difalApi.consultarLote,
    onSuccess: () => { recarregar(); qc.invalidateQueries({ queryKey: ['difal-guias-pendentes'] }) }, // guia aceita libera o "Comprovante enviado"
    onError: (e) => setErro(mensagemErro(e)),
  })
  const desfazer = useMutation({
    mutationFn: difalApi.desfazerLote,
    onSuccess: () => {
      recarregar()
      qc.invalidateQueries({ queryKey: ['difal-guias-pendentes'] })
    },
    onError: (e) => setErro(mensagemErro(e)),
  })
  const devolver = useMutation({
    mutationFn: difalApi.devolverRecusadas,
    onSuccess: (r) => {
      setErro(r.notasDevolvidas ? null : 'Nenhuma nota a devolver: as recusadas deste lote já voltaram para a fila.')
      recarregar()
      qc.invalidateQueries({ queryKey: ['difal-guias-pendentes'] })
    },
    onError: (e) => setErro(mensagemErro(e)),
  })
  const xml = useMutation({ mutationFn: difalApi.baixarXmlLote, onSuccess: (r) => baixarArquivo(r.arquivo, r.nome) })
  const pdf = useMutation({ mutationFn: difalApi.baixarPdfLote, onSuccess: (r) => baixarArquivo(r.arquivo, r.nome), onError: (e) => setErro(mensagemErro(e)) })

  if (lotes.length === 0) {
    return (
      <div className="rounded-2xl border border-violet-200 bg-white p-6 text-center text-sm text-slate-500">
        Nenhum lote gerado ainda. Marque as notas em <b>Vendas</b> e clique em <b>Baixar lote GNRE</b>; o lote aparece aqui para enviar ao portal.
      </div>
    )
  }
  const ocupado = enviar.isPending || consultar.isPending || desfazer.isPending || devolver.isPending
  // guia que não pode ser paga: recusada (1/2) ou erro de comunicação (3) sem código de barras (mesma regra do servidor)
  const naoPagavel = (g: DifalGuiaResultado) =>
    !g.devolvida && (['1', '2'].includes(g.situacaoGuia) || (g.situacaoGuia === '3' && !g.linhaDigitavel && !g.codigoBarras && !g.qrcodePayload))

  return (
    <div className="difal-secao difal-secao-violeta overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="difal-cab-violeta flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <p className="text-base font-semibold text-slate-900">Lotes GNRE gerados</p>
        {portal && (
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
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
      <div className="difal-escalonado grid gap-3 p-4 lg:grid-cols-2">
        {lotes.map((l: DifalLote) => {
          const podeEnviar = !l.numeroRecibo && !!portal?.empresas[l.empresa as 'AVIC' | 'AGRO']
          // cor do cartão pela situação das guias: todas processadas = verde; alguma invalidada/erro = vermelho
          const situacoes = l.guiasResultado.map((g) => g.situacaoGuia)
          const tomLote = situacoes.length === 0 ? 'border-slate-200 bg-white'
            : situacoes.every((s) => s === '0') ? 'border-emerald-200 bg-emerald-50/40'
            : situacoes.some((s) => s !== '0' && s !== '4') ? 'border-rose-200 bg-rose-50/40'
            : 'border-amber-200 bg-amber-50/40'
          return (
            <div key={l.id} className={`difal-cartao rounded-xl border p-4 text-sm ${tomLote}`}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium text-slate-900">{l.id}</span>
                <span className="text-slate-600">{l.guias} guia(s) · {brl(l.total)} · gerado em {dataBr(l.criadoEm)}</span>
                {l.ambiente === 'homologacao' && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">teste</span>
                )}
                {l.numeroRecibo ? (
                  <span className="text-gray-600">recibo {l.numeroRecibo} · {l.situacaoDescricao ?? 'aguardando consulta'}</span>
                ) : l.situacaoDescricao ? (
                  <span className="text-amber-700">{l.situacaoDescricao}</span>
                ) : (
                  <span className="text-gray-500">não enviado ao portal</span>
                )}
                <span className="mt-2 flex w-full flex-wrap gap-2">
                  <button onClick={() => xml.mutate(l.id)} className="difal-btn rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs hover:border-slate-300">XML</button>
                  {podeEnviar && (
                    <button
                      onClick={() => { setErro(null); enviar.mutate(l.id) }}
                      disabled={ocupado}
                      className="difal-btn rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {enviar.isPending ? 'Enviando…' : 'Enviar ao portal'}
                    </button>
                  )}
                  {l.numeroRecibo && (
                    <button
                      onClick={() => { setErro(null); consultar.mutate(l.id) }}
                      disabled={ocupado}
                      className="difal-btn rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs hover:border-slate-300 disabled:opacity-50"
                    >
                      {consultar.isPending ? 'Consultando…' : 'Consultar resultado'}
                    </button>
                  )}
                  {/* mesma regra do servidor: não enviado, ou enviado com todas as guias invalidadas (1 portal, 2 UF) */}
                  {(!l.numeroRecibo || (l.guiasResultado.length > 0 && l.guiasResultado.every((g) => ['1', '2'].includes(g.situacaoGuia)))) && (
                    <button
                      onClick={() => { setErro(null); if (window.confirm(`Desfazer o lote ${l.id}? As notas voltam para a fila de guias pendentes.`)) desfazer.mutate(l.id) }}
                      disabled={ocupado}
                      className="difal-btn rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                    >
                      Desfazer
                    </button>
                  )}
                  {/* lote misto: devolve à fila só as guias que não podem ser pagas (recusadas, ou erro de comunicação sem
                      código de barras), para gerar de novo */}
                  {l.guiasResultado.some(naoPagavel) && !l.guiasResultado.every((g) => ['1', '2'].includes(g.situacaoGuia)) && (
                    <button
                      onClick={() => {
                        setErro(null)
                        const n = l.guiasResultado.filter(naoPagavel).length
                        if (window.confirm(`Devolver à fila as ${n} nota(s) com guia recusada ou com erro de comunicação (sem código de barras, não podem ser pagas)? As guias aceitas continuam neste lote. Depois, gere um lote novo com elas.`)) devolver.mutate(l.id)
                      }}
                      disabled={ocupado}
                      className="difal-btn rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                    >
                      {devolver.isPending ? 'Devolvendo…' : 'Devolver à fila as que não podem ser pagas'}
                    </button>
                  )}
                  {l.temPdf && (
                    <button onClick={() => pdf.mutate(l.id)} className="difal-btn rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700">
                      PDF das guias
                    </button>
                  )}
                </span>
              </div>
              {l.guiasResultado.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-slate-200/70 pt-2 text-xs text-slate-600">
                  {l.guiasResultado.map((g, i) => (
                    <li key={i}>
                      {g.devolvida && <span className="mr-1 rounded bg-slate-800 px-1.5 py-0.5 font-semibold text-white">devolvida à fila · NÃO PAGAR</span>}
                      <span className={g.devolvida ? 'text-slate-400 line-through' : g.situacaoGuia === '0' ? 'text-emerald-700' : 'text-red-700'}>{g.situacaoTexto}</span>
                      {' · '}{g.identificadorGuia ? `NF ${g.identificadorGuia}` : g.ufFavorecida}
                      {g.valorGNRE && <> · {brl(Number(g.valorGNRE))}</>}
                      {g.dataLimitePagamento && <> · pagar até {g.dataLimitePagamento}</>}
                      {g.linhaDigitavel && <> · linha digitável <code className="select-all break-all rounded bg-white px-1 py-0.5 ring-1 ring-slate-200">{g.linhaDigitavel}</code></>}
                      {g.motivos.map((m) => <span key={m.codigo} className="text-red-700"> · {m.codigo} {m.descricao}{m.campo ? ` (${m.campo})` : ''}</span>)}
                      {!g.devolvida && (g.linhaDigitavel || g.qrcodePayload) && (
                        <span className="mt-1.5 flex flex-wrap gap-2">
                          {g.linhaDigitavel && <BotaoCopiar texto={g.linhaDigitavel} rotulo="Copiar código de barras" />}
                          {g.qrcodePayload && <BotaoCopiar texto={g.qrcodePayload} rotulo="Copiar PIX" />}
                        </span>
                      )}
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
/** Rotina diária das 16h: mostra como está ligada e simula a mensagem com os dados de agora (não envia nada). */
function RotinaDiaria() {
  const simular = useMutation({ mutationFn: difalApi.simularRotina })
  const r = simular.data
  return (
    <div className="difal-cartao flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><Icone nome="atualizar" /></span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900">Rotina diária (16h, dias úteis)</p>
        <p className="text-xs text-slate-500">
          Atualiza as notas, monta a lista do dia (no prazo, estados com cobrança) e manda o resumo no WhatsApp. Nota emitida até as 16h59 vence no mesmo dia; a partir das 17h, no próximo dia útil. O pagamento continua com você.
        </p>
        <button onClick={() => simular.mutate()} disabled={simular.isPending}
          className="difal-btn mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-300 disabled:opacity-60">
          {simular.isPending ? 'Montando…' : 'Rodar rotina agora (simulação)'}
        </button>
        {simular.isError && <p className="mt-2 text-xs text-rose-600">{mensagemErro(simular.error)}</p>}
        {r && (
          <div className="difal-entrar mt-3 space-y-2">
            <ul className="text-xs text-slate-600">
              <li>Agendamento: <b>{r.agendada ? 'ligado' : 'desligado'}</b>{!r.agendada && ' (variável DIFAL_ROTINA=1 no Railway)'}</li>
              <li>Modo: <b>{r.modoCompleto ? 'completo (gera e envia os lotes ao portal; só com o portal em produção)' : 'só aviso'}</b></li>
              <li>WhatsApp: <b>{r.temNumero ? 'número configurado' : 'sem número (DIFAL_WHATSAPP_NUMERO)'}</b></li>
              <li>
                Última execução:{' '}
                {r.ultimaExecucao ? (
                  <b className={r.ultimaExecucao.ok ? 'text-emerald-700' : 'text-rose-700'}>
                    {formatDateTime(r.ultimaExecucao.em)} · {r.ultimaExecucao.ok ? 'ok' : 'FALHOU'} · {r.ultimaExecucao.enviadaWhatsapp ? 'WhatsApp enviado' : 'WhatsApp NÃO enviado'} — {r.ultimaExecucao.resumo}
                  </b>
                ) : <b>nenhuma desde o último deploy</b>}
              </li>
            </ul>
            <p className="text-xs text-slate-500">Mensagem que iria agora (simulação: usa as notas já importadas, não gera lote nem envia nada):</p>
            <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-800 ring-1 ring-slate-100">{r.pulou ? `Não rodou: ${r.pulou}` : r.mensagem}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

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
    mutationFn: ({ uf, dados }: { uf: string; dados: { codigoReceitaGnre?: string; vencimentoRegra?: string; tipoDocOrigemGnre?: string; camposAdicionais?: DifalReceitaUf['camposAdicionais']; exigeProduto?: boolean; exigePeriodo?: boolean } }) =>
      difalApi.atualizarAliquota(uf, dados),
    onSuccess: () => { recarregar(); setUfAberta(null); buscar.reset() },
    onError: (e) => setErro(mensagemErro(e)),
  })

  const certificadoOk = !!portal?.empresas[empresa]
  const semReceita = aliquotas.filter((a) => !a.codigoReceitaGnre).length

  return (
    <div className="space-y-5">
      <div className="difal-cartao flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 text-sm">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Icone nome="cadeado" /></span>
        <div>
        <p className="font-semibold text-slate-900">Portal GNRE</p>
        {portal ? (
          <ul className="mt-1 space-y-0.5 text-slate-600">
            <li>Ambiente: <b>{portal.ambiente === 'producao' ? 'PRODUÇÃO' : 'homologação (testes)'}</b> — {portal.host}</li>
            <li>Certificado AVIC: {portal.empresas.AVIC ? 'configurado' : 'não configurado (GNRE_PFX_ARQUIVO_AVIC ou GNRE_PFX_BASE64_AVIC + GNRE_PFX_SENHA_AVIC)'}</li>
            <li>Certificado AGRO: {portal.empresas.AGRO ? 'configurado' : 'não configurado (GNRE_PFX_ARQUIVO_AGRO ou GNRE_PFX_BASE64_AGRO + GNRE_PFX_SENHA_AGRO)'}</li>
          </ul>
        ) : (
          <p className="text-slate-500">carregando…</p>
        )}
        </div>
      </div>

      <RotinaDiaria />

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="font-semibold text-slate-900">Código de receita GNRE por estado</p>
            <p className="text-xs text-gray-500">
              Cada UF publica o seu código no portal (serviço GnreConfigUF). Sem ele a guia não fica &ldquo;pronta&rdquo;.
              {semReceita > 0 && <> <b>{semReceita}</b> estado(s) ainda sem código.</>}
            </p>
          </div>
          <label className="text-sm text-gray-600">
            Consultar com o certificado da{' '}
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value as 'AVIC' | 'AGRO')} className="rounded-lg border border-slate-200 px-2 py-1 text-sm outline-none focus:ring-4 focus:ring-blue-100">
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
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-2.5 text-left">UF</th>
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
                <tr className={`transition-colors hover:bg-slate-50 ${a.codigoReceitaGnre ? '' : 'bg-amber-50/40'}`}>
                  <td className="px-4 py-2 font-medium text-gray-900" title={a.nome}>{a.uf}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">{pct(a.aliquotaInterna)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-600">{pct(a.interestadual)}</td>
                  <td className="px-2 py-2 text-gray-600">{a.metodo}</td>
                  <td className="px-2 py-2 tabular-nums">{a.codigoReceitaGnre ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{a.codigoReceitaGnre}</span> : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">falta</span>}</td>
                  <td className="px-2 py-2">
                    <select
                      value={a.vencimentoRegra}
                      onChange={(e) => salvar.mutate({ uf: a.uf, dados: { vencimentoRegra: e.target.value } })}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:ring-4 focus:ring-blue-100"
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
                      className="difal-btn rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs hover:border-slate-300 disabled:opacity-40"
                    >
                      {buscar.isPending && ufAberta === a.uf ? 'Consultando…' : 'Buscar receitas no portal'}
                    </button>
                  </td>
                </tr>
                {ufAberta === a.uf && buscar.data && (
                  <tr>
                    <td colSpan={7} className="difal-entrar bg-slate-50 px-5 py-3">
                      <p className="mb-2 text-xs text-gray-600">
                        {buscar.data.receitas.length} receita(s) em {a.uf} ({buscar.data.situacao.descricao}). Escolha a de ICMS para consumidor final não contribuinte:
                      </p>
                      <ul className="space-y-1">
                        {buscar.data.receitas.map((r: DifalReceitaUf) => (
                          <li key={`${r.codigo}-${r.courier}`} className="flex flex-wrap items-center gap-2 text-xs">
                            <button
                              onClick={() => salvar.mutate({ uf: a.uf, dados: { codigoReceitaGnre: r.codigo, tipoDocOrigemGnre: tipoDocPreferido(r), camposAdicionais: r.camposAdicionais, exigeProduto: r.exigeProduto, exigePeriodo: r.exigePeriodoReferencia } })}
                              className="difal-btn rounded-lg bg-slate-900 px-2.5 py-1 text-white hover:bg-slate-800"
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

// ------------------------------------------------- Guias emitidas: registro e pagamento
const SITUACAO_PORTAL: Record<string, [string, string]> = {
  '0': ['aceita', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  '1': ['recusada pelo portal', 'bg-rose-50 text-rose-700 ring-rose-200'],
  '2': ['recusada pelo estado', 'bg-rose-50 text-rose-700 ring-rose-200'],
  '3': ['erro de comunicação', 'bg-amber-50 text-amber-700 ring-amber-200'],
  '4': ['processando', 'bg-sky-50 text-sky-700 ring-sky-200'],
}

function GuiasEmitidas() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['difal-guias-emitidas'], queryFn: difalApi.guiasEmitidas })
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set())
  const [dataPagamento, setDataPagamento] = useState(isoDia(new Date()))
  const [filtro, setFiltro] = useState<'todas' | 'nao_pagas' | 'pagas'>('todas')
  const [busca, setBusca] = useState('')
  const [canal, setCanal] = useState('')
  const [soComCobranca, setSoComCobranca] = useState(true)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const marcar = useMutation({
    mutationFn: ({ ids, data: d }: { ids: string[]; data: string | null }) => difalApi.marcarPagas(ids, d),
    onSuccess: (r) => {
      setEscolhidas(new Set())
      if (r.recusadas > 0) setErro(`${r.recusadas} guia(s) não foram marcadas: só guia aceita pelo portal em produção pode ser paga (recusada ou de teste, não).`)
      qc.invalidateQueries({ queryKey: ['difal-guias-emitidas'] })
      qc.invalidateQueries({ queryKey: ['difal-resumo'] })
    },
    onError: (e) => setErro(mensagemErro(e)),
  })
  if (isLoading || !data) return null

  const visiveis = data.guias
    .filter((g) => !soComCobranca || g.estadoComCobranca)
    .filter((g) => (!de || g.geradaEm >= de) && (!ate || g.geradaEm <= ate))
    .filter((g) => filtro === 'todas' || (filtro === 'pagas' ? !!g.pagaEm : !g.pagaEm))
    .filter((g) => bateBusca(busca, g, [g.loteId, g.linhaDigitavel]))
    .filter((g) => !canal || nomeCanal(g.canal) === canal)
  const totalPago = visiveis.reduce((s, g) => s + (g.valorPago ?? 0), 0)
  // só as marcadas que estão na tela: trocar o filtro não pode deixar escondida uma guia marcada
  const marcadas = visiveis.filter((g) => escolhidas.has(g.id)).map((g) => g.id)
  const totalAPagar = visiveis.filter((g) => !g.pagaEm && g.situacaoPortal === '0').reduce((s, g) => s + g.difalCalculado, 0)
  function alternar(id: string) {
    setEscolhidas((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  // planilha para a contabilidade: sem nome nem CPF do cliente (LGPD)
  function baixar() {
    const linhas = [['Empresa', 'NF', 'UF', 'Canal', 'DIFAL (R$)', 'Lote', 'Gerada em', 'Portal', 'Atrasada (sem multa/juros)', 'Paga em', 'Valor pago (R$)', 'Comprovante no ML'].join(';')].concat(
      visiveis.map((g) => [
        g.empresa, g.nfNumero, g.clienteUf, g.canal ?? 'Balcão', g.difalCalculado.toFixed(2).replace('.', ','), g.loteId, dataBr(g.geradaEm),
        SITUACAO_PORTAL[g.situacaoPortal ?? '']?.[0] ?? 'sem resultado', g.atrasada ? 'sim' : 'não', g.pagaEm ? dataBr(g.pagaEm) : '',
        g.valorPago != null ? g.valorPago.toFixed(2).replace('.', ',') : '', g.comprovanteMlEnviadoEm ? dataBr(g.comprovanteMlEnviadoEm) : '',
      ].map((v) => String(v).replace(/;/g, ',')).join(';'))
    )
    baixarArquivo(new Blob(['\ufeff' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `difal-guias-emitidas-${isoDia(new Date())}.csv`)
  }

  return (
    <div className="space-y-4">
      {data.alertas.map((a, i) => (
        <div key={i} className={`difal-entrar flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${a.tipo === 'dobro' ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <Icone nome="alerta" className="mt-0.5 h-4 w-4 shrink-0" />
          <span><b>{a.tipo === 'dobro' ? 'Possível guia em dobro: ' : 'Sem pagamento marcado: '}</b>{a.texto}</span>
        </div>
      ))}
      {erro && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">{erro}</div>}
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={DICA_BUSCA} className={CAMPO_BUSCA} />
        <FiltroCanal canais={data.guias.map((g) => g.canal)} valor={canal} onTrocar={setCanal} />
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
          <span>Geradas de</span>
          <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm" />
          <span>até</span>
          <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm" />
          <span className="ml-1 inline-flex rounded-lg bg-slate-100 p-0.5 text-xs">
            {atalhosPeriodo().map(([rotulo, d, a]) => (
              <button key={rotulo} onClick={() => { setDe(d); setAte(a) }}
                className={`rounded-md px-2.5 py-1 ${de === d && ate === a ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{rotulo}</button>
            ))}
          </span>
        </div>
        <span className="inline-flex rounded-xl bg-white p-1 text-sm ring-1 ring-slate-200">
          {([['todas', 'Todas'], ['nao_pagas', 'Não pagas'], ['pagas', 'Pagas']] as const).map(([v, r]) => (
            <button key={v} onClick={() => setFiltro(v)} className={`rounded-lg px-3 py-1 ${filtro === v ? 'bg-gradient-to-r from-indigo-600 to-sky-500 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{r}</button>
          ))}
        </span>
        <label className="flex cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
          <input type="checkbox" checked={soComCobranca} onChange={(e) => setSoComCobranca(e.target.checked)} className="h-4 w-4 accent-blue-600" />
          Só estados com cobrança de DIFAL
        </label>
      </div>
      <div className="difal-secao difal-secao-violeta overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="difal-cab-violeta flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-base font-semibold text-slate-900">Guias emitidas</p>
            <p className="text-xs text-slate-500">{visiveis.length} guia(s) · pago {brl(totalPago)} · aceitas e ainda não pagas {brl(totalAPagar)}</p>
          </div>
          <span className="flex flex-wrap items-center gap-2">
            {marcadas.length > 0 && (
              <>
                <input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" />
                <button onClick={() => { setErro(null); marcar.mutate({ ids: marcadas, data: dataPagamento }) }} disabled={marcar.isPending}
                  className="difal-btn rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-4 py-2 text-sm font-medium text-white shadow-md shadow-emerald-500/30 disabled:opacity-40">
                  Marcar como paga ({marcadas.length})
                </button>
                <button onClick={() => { setErro(null); if (window.confirm(`Desmarcar ${marcadas.length} guia(s) como paga(s)?`)) marcar.mutate({ ids: marcadas, data: null }) }}
                  className="difal-btn rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">Desmarcar</button>
              </>
            )}
            <button onClick={baixar} className="difal-btn rounded-xl border border-violet-200 bg-white px-4 py-2 text-sm text-violet-700 hover:bg-violet-50">Baixar planilha</button>
          </span>
        </div>
        {visiveis.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-slate-500">Nenhuma guia emitida com esses filtros.</p>
        ) : (
        <div className="max-h-[560px] overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-gradient-to-r from-violet-50 to-indigo-50 text-left text-xs uppercase tracking-wide text-violet-900/60">
            <tr><th className="w-10 px-5 py-2"></th><th className="px-2 py-2">Nota / cliente</th><th className="px-2 py-2">UF</th><th className="px-2 py-2">Canal</th><th className="px-2 py-2 text-right">Valor da NF</th><th className="px-2 py-2 text-right">DIFAL</th><th className="px-2 py-2">Gerada</th><th className="px-2 py-2">Portal</th><th className="px-2 py-2">Pagamento</th><th className="px-5 py-2">Código</th></tr>
          </thead>
          <tbody className="difal-linhas divide-y divide-slate-100">
            {visiveis.map((g) => {
              const portal = SITUACAO_PORTAL[g.situacaoPortal ?? '']
              return (
                <tr key={g.id}>
                  <td className="px-5 py-2.5"><input type="checkbox" checked={escolhidas.has(g.id)} onChange={() => alternar(g.id)} className="h-4 w-4 accent-violet-600" /></td>
                  <td className="px-2 py-2.5"><NotaCliente nf={g.nfNumero} empresa={g.empresa} cliente={g.clienteNome} itens={g.itens} /></td>
                  <td className="px-2 py-2.5"><span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">{g.clienteUf}</span></td>
                  <td className="px-2 py-2.5 text-xs">
                    <span className="flex flex-col gap-1">
                      <span className={`w-fit max-w-[150px] truncate rounded-md px-1.5 py-0.5 font-medium ring-1 ${corCanal(g.canal)}`}>{g.canal ?? 'Balcão'}</span>
                      {g.ml && g.mlLogistica && <span className={`w-fit rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${COR_LOGISTICA[g.mlLogistica] ?? 'bg-slate-50 text-slate-600 ring-slate-200'}`}>{g.mlLogistica}</span>}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-slate-600">{brl(g.valorNota)}</td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-violet-700">
                    <ComDica largura={460} altura={340} conteudo={<CalculoDaNota d={g.calculoDetalhe} total={g.difalCalculado} />}>
                      <span className="cursor-help underline decoration-dotted decoration-slate-300 underline-offset-4">{brl(g.difalCalculado)}</span>
                    </ComDica>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-slate-600">
                    {dataBr(g.geradaEm)}
                    <span className="block text-[11px] text-slate-400">{g.loteId}{g.ambiente === 'homologacao' ? ' · teste' : ''}</span>
                  </td>
                  <td className="px-2 py-2.5 text-xs">
                    <span className={`rounded-full px-2 py-0.5 font-medium ring-1 ${portal?.[1] ?? 'bg-slate-50 text-slate-500 ring-slate-200'}`}>{portal?.[0] ?? (g.enviadaEm ? 'aguardando resultado' : 'não enviada')}</span>
                  </td>
                  <td className="px-2 py-2.5 text-xs">
                    <span className="flex flex-col gap-1">
                      {g.pagaEm
                        ? <span className="w-fit rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-emerald-200">paga em {dataBr(g.pagaEm)}</span>
                        : <span className="w-fit rounded-full bg-slate-50 px-2 py-0.5 text-slate-500 ring-1 ring-slate-200">não paga</span>}
                      {g.atrasada && <span className="w-fit rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700 ring-1 ring-rose-200" title="guia gerada depois do dia em que o DIFAL vencia (regra do mesmo dia); saiu só com o imposto">gerada depois do prazo</span>}
                      {g.ml && <span className="w-fit rounded-full bg-yellow-50 px-2 py-0.5 text-yellow-800 ring-1 ring-yellow-200">{g.comprovanteMlEnviadoEm ? `comprovante no ML ${dataBr(g.comprovanteMlEnviadoEm)}` : 'comprovante no ML: falta'}</span>}
                    </span>
                  </td>
                  <td className="px-5 py-2.5 text-xs">{g.linhaDigitavel ? <BotaoCopiar texto={g.linhaDigitavel} rotulo="Copiar código" /> : <span className="text-slate-400">—</span>}</td>
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
      <GuiasEmitidas />

      <h2 className="pt-2 text-base font-semibold text-slate-900">Histórico auditado: o que cada estado cobrou (dez/2025 a nov/2026)</h2>
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5">
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

      <div className="difal-escalonado grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Numero icone="alerta" titulo="Pago a mais" valor={brl(h.resumo.aMais)} detalhe="o que não precisávamos ter pago" tom="alerta" />
        <Numero icone="moedas" titulo="DIFAL devido" valor={brl(h.resumo.devido)} detalhe={`pagamos ${brl(h.resumo.pago)}`} />
        <Numero icone="documento" titulo="Multa e juros" valor={brl(h.resumo.encargos)} detalhe="encargos por atraso" />
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
        <div className="difal-escalonado space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
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
                <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="difal-barra absolute inset-y-0 left-0 rounded-full bg-amber-400"
                    style={{ width: `${Math.min((e.pctCobrado / maior) * 100, 100)}%` }}
                  />
                  <div
                    className="difal-barra absolute inset-y-0 left-0 rounded-full bg-slate-400"
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
          className="difal-btn rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:border-slate-300"
        >
          {verNotas ? 'Esconder' : 'Ver'} as {h.notas.length} notas auditadas
        </button>
        {verNotas && (
          <div className="difal-entrar mt-3 max-h-[420px] overflow-auto rounded-2xl border border-slate-200 bg-white">
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
  const [aba, setAba] = useState<NomeAba>('vendas')
  // lugar dos cards da aba Vendas: acima das abas (a aba Vendas desenha neles com createPortal)
  const [lugarCards, setLugarCards] = useState<HTMLDivElement | null>(null)

  return (
    // mesma margem das outras páginas (p-6): sem ela o conteúdo encosta na barra lateral
    <div className="difal-fundo min-h-screen space-y-4 p-6">
      {/* cabeçalho numa linha só; a engrenagem fica dentro da linha (antes, absoluta, o título passava por cima e engolia o clique) */}
      <div className="difal-hero flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20 backdrop-blur"><Icone nome="documento" className="h-5 w-5 text-sky-300" /></span>
        <h1 className="text-2xl font-semibold tracking-tight">DIFAL</h1>
        <span className="rounded-full bg-sky-400/15 px-2.5 py-0.5 text-xs font-medium text-sky-200 ring-1 ring-sky-300/30">monitor de guias</span>
        <p className="min-w-0 flex-1 text-xs text-indigo-100/75" title="Convênio ICMS 52/91: carga total de 5,6% para o NCM 8436; a origem (RS) já recolhe 4,1%">
          NCM 8436: carga de 5,6% − 4,1% na origem = <b className="text-sky-200">1,5%</b> para o destino. Pagar no dia da emissão da NF.
        </p>
        <button
          onClick={() => setAba(aba === 'config' ? 'vendas' : 'config')}
          title={aba === 'config' ? 'Voltar para Vendas' : 'Configuração (portal GNRE, receitas por estado e rotina diária)'}
          className={`difal-btn grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 backdrop-blur transition-colors ${
            aba === 'config' ? 'bg-sky-400/30 text-white ring-sky-300/50' : 'bg-white/10 text-sky-200 ring-white/20 hover:bg-white/20'
          }`}
        >
          <Icone nome="engrenagem" className="h-5 w-5" />
        </button>
      </div>

      <div ref={setLugarCards} className={aba === 'vendas' ? '' : 'hidden'} />

      <Abas aba={aba} onTrocar={setAba} />

      {/* a chave muda a cada aba: a tela nova entra com a animação de entrada */}
      <div key={aba} className="difal-entrar">
        {aba === 'vendas' ? <Vendas lugarCards={lugarCards} /> : aba === 'lotes' ? <LotesGnre /> : aba === 'fechamento' ? <FechamentoMensal /> : aba === 'config' ? <Configuracao /> : <Historico />}
      </div>
    </div>
  )
}
