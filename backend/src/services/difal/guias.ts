/**
 * Guias de DIFAL que NÓS precisamos recolher (venda de balcão ou Loja Integrada
 * para consumidor sem inscrição estadual, fora do RS).
 *
 * Daqui saem duas coisas:
 *   - a lista do que está pendente e o que falta para cada nota virar guia;
 *   - o XML do lote GNRE (layout 2.00) pronto para o GnreLoteRecepcao.
 *
 * Nada é enviado ao portal aqui. O envio depende do certificado e-CNPJ e da
 * habilitação do webservice, que ainda estão em andamento.
 */
import type { PrismaClient, DifalNota, DifalAliquota, DifalEmitente, Prisma } from '@prisma/client'
import { montarLoteGnre, ErroMontagemGnre, LIMITE_GUIAS_POR_LOTE, type GuiaGnre } from './gnre'
import { ambienteGnre, lerResultadoLote } from './portalGnre'
import { dataBR, somarDias } from '../separacao/datas'

export interface GuiaPendente {
  id: string
  empresa: string
  nfNumero: string
  clienteNome: string
  /** itens da NF (tooltip); null se a nota ainda não foi relida depois da coluna existir */
  itens: unknown
  emitidaEm: Date
  clienteUf: string
  /** valor total da NF */
  valorNota: number
  difalCalculado: number
  /** tudo pronto para entrar no lote */
  pronta: boolean
  /** o que ainda falta, em linguagem simples */
  faltando: string[]
  /** último dia para pagar sem multa/juros (AAAA-MM-DD), pela regra de vencimento da UF */
  prazo: string
  /** passou do prazo legal: pode gerar guia, mas ela sai só com o imposto, sem multa e juros (José liberou com aviso, 20/11/2026) */
  atrasada: boolean
  /** envio da nota no order-tracker; null quando a nota não está lá (retirada, Mercado Envios, Shopee…) */
  envio: EnvioDaNota | null
  /** rastreio do Mercado Envios (venda do ML que não passa pelo order-tracker); null se não houver */
  envioMl: { status: string | null; substatus: string | null; previsao: Date | null; lidoEm: Date | null } | null
  /** venda do Mercado Livre: depois de pagar, anexar o comprovante na venda do ML */
  ml: boolean
  mlOrderId: string | null
  /** venda do ML com guia já gerada, esperando pagamento e comprovante */
  guiaGeradaEm: Date | null
  /** situação da guia no portal: 0 aceita, 1/2 recusada, 3 erro de comunicação, 4 pendente; null = sem resultado */
  situacaoGuia: string | null
  /** a guia foi processada com sucesso pelo portal (libera 'Comprovante enviado') */
  guiaAceita: boolean
  situacao: string
  observacao: string | null
  /** estado em que já tivemos cobrança de DIFAL (UFS_COM_COBRANCA): a tela mostra só esses por padrão */
  estadoComCobranca: boolean
  /** a conta do DIFAL como foi feita na importação (tooltip no valor) */
  calculoDetalhe: unknown
  /** plataforma da venda (canal do Bling) e, no ML, o tipo de envio */
  canal: string | null
  mlLogistica: string | null
}

export interface EnvioDaNota {
  /** id do pedido no order-tracker: abre a janela 'Detalhes do Pedido' */
  pedidoId: string
  situacao: 'PENDING' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED'
  transportadora: string | null
  enviadoEm: Date | null
  previsao: Date | null
  entregueEm: Date | null
  ultimoRastreio: string | null
  /** ocorrência no transporte (avaria, extravio...), como no selo da tela de Pedidos */
  temOcorrencia: boolean
}

/** mesmo formato que a importação do Bling usa para criar o pedido: AVIC-NF-013234 */
function numeroDoPedido(empresa: string, nfNumero: string): string {
  return `${empresa}-NF-${nfNumero.replace(/^0+/, '').padStart(6, '0')}`
}

/** Tipos de documento de origem que usam a chave de 44 dígitos (GnreConfigUF): 22 = chave da NF-e, 24 = chave do DF-e */
const TIPOS_DOC_COM_CHAVE = new Set(['22', '24'])

/** Campo extra obrigatório de uma UF, já com o que o sistema põe nele. */
export interface CampoExtraUf {
  codigo: string
  titulo: string
  conteudo: 'chaveNfe' | 'dataEmissao' | 'observacao' | 'desconhecido'
}

/**
 * Lê os campos adicionais OBRIGATÓRIOS do GnreConfigUF e decide o que vai em cada um, pelo título e tipo.
 * O que não for reconhecido fica 'desconhecido' e trava a nota ("falta"), em vez de ir errado ao portal.
 */
export function classificarCamposExtras(
  campos: { codigo: string; titulo: string; tipo: string; obrigatorio: boolean }[],
  exigeProduto = false
): CampoExtraUf[] {
  // 'produto' é uma categoria escolhida numa lista da UF (ex.: MA, 89 opções): decisão fiscal, ainda não definida.
  const produto: CampoExtraUf[] = exigeProduto
    ? [{ codigo: 'produto', titulo: 'categoria de produto exigida pela UF (definir com a contabilidade)', conteudo: 'desconhecido' }]
    : []
  return produto.concat(campos
    .filter((c) => c.obrigatorio)
    .map((c) => {
      const titulo = c.titulo.toLowerCase()
      const conteudo: CampoExtraUf['conteudo'] = titulo.includes('chave')
        ? 'chaveNfe'
        : c.tipo === 'D' && titulo.includes('emiss')
          ? 'dataEmissao'
          : titulo.includes('observa')
            ? 'observacao'
            : 'desconhecido'
      return { codigo: c.codigo, titulo: c.titulo, conteudo }
    }))
}

/** Observação pedida pelo TO (até 15 caracteres): definido pelo José em 20/11/2026 */
const TAMANHO_OBSERVACAO = 15

export function valorCampoExtra(c: CampoExtraUf, nota: DifalNota): string | null {
  if (c.conteudo === 'chaveNfe') return nota.nfChave
  // emitidaEm guarda o horário de Brasília como se fosse UTC (o Bling manda a data sem fuso e o importador
  // faz new Date no servidor em UTC): as partes UTC dão o dia da nota, como na referência e no vencimento.
  if (c.conteudo === 'dataEmissao') return aaaaMmDd(nota.emitidaEm)
  if (c.conteudo === 'observacao') {
    const numero = nota.nfNumero.replace(/^0+/, '')
    // sem cortar o número: se 'DIFAL NF ' não couber, fica só 'NF '; se nem assim, a nota trava (null)
    return [`DIFAL NF ${numero}`, `NF ${numero}`].find((t) => t.length <= TAMANHO_OBSERVACAO) ?? null
  }
  return null
}

function camposExtrasDaUf(aliquota: DifalAliquota): CampoExtraUf[] {
  return Array.isArray(aliquota.camposExtrasGnre) ? (aliquota.camposExtrasGnre as unknown as CampoExtraUf[]) : []
}

/** tipoDocOrigemGnre vazio = a UF não exige documento de origem para a receita (GnreConfigUF) */
const SEM_DOCUMENTO_ORIGEM = ''
/** tipos que o sistema sabe preencher: nenhum, número da nota (10), chave da NF-e (22) ou do DF-e (24) */
const TIPOS_DOC_SUPORTADOS = new Set([SEM_DOCUMENTO_ORIGEM, '10', '22', '24'])
/** XSD dados_gnre_v2.00: camposExtras tem no máximo 3 campoExtra */
const LIMITE_CAMPOS_EXTRAS = 3

function documentoOrigem(nota: DifalNota, tipo: string): string | null {
  return TIPOS_DOC_COM_CHAVE.has(tipo) ? nota.nfChave : nota.nfNumero
}

function oQueFalta(nota: DifalNota, aliquota: DifalAliquota | undefined, emitente: DifalEmitente | undefined): string[] {
  const f: string[] = []
  if (!nota.municipioIbgeDestino) f.push('município do destinatário (reimportar a nota para ler o XML)')
  if (!nota.documentoDestinatario) f.push('CPF/CNPJ do destinatário (reimportar a nota para ler o XML)')
  if (!aliquota?.codigoReceitaGnre) f.push(`código de receita GNRE de ${nota.clienteUf} (vem do GnreConfigUF)`)
  if (!emitente) f.push(`dados do emitente ${nota.empresa} (reimportar uma nota da empresa)`)
  if (aliquota && aliquota.tipoDocOrigemGnre !== SEM_DOCUMENTO_ORIGEM && !documentoOrigem(nota, aliquota.tipoDocOrigemGnre)) {
    f.push('chave de acesso da NF-e (reimportar a nota)')
  }
  if (aliquota?.codigoReceitaGnre && aliquota.camposExtrasGnre === null) {
    // receita escolhida antes de existir esta coluna: sem saber os campos extras, não dá para montar a guia
    f.push(`reconfigurar a receita de ${nota.clienteUf} (Configuração: "usar ${aliquota.codigoReceitaGnre}" de novo)`)
  }
  if (aliquota && !TIPOS_DOC_SUPORTADOS.has(aliquota.tipoDocOrigemGnre)) {
    f.push(`documento de origem tipo ${aliquota.tipoDocOrigemGnre} exigido por ${nota.clienteUf}, que o sistema não preenche`)
  }
  if (aliquota && camposExtrasDaUf(aliquota).length > LIMITE_CAMPOS_EXTRAS) {
    f.push(`${nota.clienteUf} exige mais de ${LIMITE_CAMPOS_EXTRAS} campos extras (o portal aceita até ${LIMITE_CAMPOS_EXTRAS})`)
  }
  for (const c of aliquota ? camposExtrasDaUf(aliquota) : []) {
    if (c.conteudo === 'desconhecido') f.push(`campo extra "${c.titulo}" (código ${c.codigo}) que o sistema não sabe preencher`)
    else if (!valorCampoExtra(c, nota)) f.push(`${c.titulo} para o campo extra ${c.codigo} (reimportar a nota)`)
  }
  return f
}

const SITUACOES_ABERTAS = ['PENDENTE', 'ATRASADO'] as const

/** situação (0 = processada) da guia desta nota no resultado do lote; null se o lote não foi enviado/consultado */
function situacaoDaGuia(nota: { nfNumero: string }, resultadoXml: string | null | undefined): string | null {
  if (!resultadoXml) return null
  const id = nota.nfNumero.replace(/\D/g, '').slice(-10) // mesmo identificadorGuia da montagem do lote
  return lerResultadoLote(resultadoXml).guias.find((g) => g.identificadorGuia === id)?.situacaoGuia ?? null
}

/** José anexou o comprovante na venda do ML: a venda sai da lista e deixa de contar como 'ML cobra' no fechamento. */
export async function marcarComprovanteMlEnviado(prisma: PrismaClient, id: string): Promise<void> {
  const n = await prisma.difalNota.findUnique({ where: { id }, select: { responsavel: true, guiaGeradaEm: true, guiaLoteId: true, nfNumero: true, situacao: true } })
  if (!n) throw new ErroMontagemGnre('nota não encontrada')
  if (n.responsavel !== 'ML_PAGA') throw new ErroMontagemGnre(`a nota ${n.nfNumero} não é venda do ML`)
  if (!n.guiaGeradaEm || !n.guiaLoteId) throw new ErroMontagemGnre(`a nota ${n.nfNumero} ainda não tem guia gerada`)
  if (n.situacao === 'DIVERGENTE') throw new ErroMontagemGnre(`a nota ${n.nfNumero} está divergente (cancelada ou com problema): confira antes`)
  const lote = await prisma.difalLoteGnre.findUnique({ where: { id: n.guiaLoteId }, select: { resultadoXml: true } })
  if (situacaoDaGuia(n, lote?.resultadoXml) !== '0') {
    throw new ErroMontagemGnre(`a guia da nota ${n.nfNumero} ainda não foi aceita pelo portal: envie o lote e consulte o resultado`)
  }
  await prisma.difalNota.update({ where: { id }, data: { comprovanteMlEnviadoEm: new Date() } })
}

/**
 * Estados em que já tivemos cobrança de DIFAL: os 7 do histórico auditado (AL, AM, CE, PB, PI, RN, TO) mais o AC,
 * que aparece nos ZIPs de comprovantes do ML (dez/2025–nov/2026). Os demais o José confere com a contabilidade
 * (decisão de 20/11/2026): a tela esconde esses por padrão.
 */
export const UFS_COM_COBRANCA = ['AC', 'AL', 'AM', 'CE', 'PB', 'PI', 'RN', 'TO']

/** notas nossas entram na lista de Vendas se emitidas nos últimos 90 dias (a importação padrão); as mais antigas
 * ficam com a contabilidade e só servem ao fechamento */
const JANELA_NOSSAS_DIAS = 90
function limiteNossas(): Date {
  return new Date(`${somarDias(dataBR(), -JANELA_NOSSAS_DIAS)}T00:00:00Z`) // emitidaEm guarda Brasília como UTC
}

/** Vendas do ML que pagamos nós: sem guia e com nota de até 30 dias, ou com guia gerada e comprovante ainda não enviado */
export function filtroVendasMl(): Prisma.DifalNotaWhereInput {
  const limite = new Date(`${somarDias(dataBR(), -JANELA_ML_DIAS)}T00:00:00Z`) // emitidaEm guarda Brasília como UTC
  return {
    responsavel: 'ML_PAGA',
    comprovanteMlEnviadoEm: null,
    OR: [
      // sem guia: só aberta (divergente = erro de cálculo ou nota cancelada: não gerar guia) e com DIFAL
      { emitidaEm: { gte: limite }, guiaGeradaEm: null, situacao: { in: [...SITUACOES_ABERTAS] }, difalCalculado: { gt: 0 } },
      { guiaGeradaEm: { not: null } },
    ],
  }
}

export async function listarGuiasPendentes(prisma: PrismaClient, empresa?: string): Promise<GuiaPendente[]> {
  const [notas, aliquotas, emitentes] = await Promise.all([
    prisma.difalNota.findMany({
      where: {
        difalCalculado: { gt: 0 },
        ...(empresa && { empresa }),
        // nós pagamos todas (decisão do José, 20/11/2026): as nossas em aberto e as do ML dos últimos 30 dias
        OR: [
          // as nossas: sem guia, ou com guia que ainda não foi aceita (recusada, erro de comunicação, sem resultado);
          // a aceita sai daqui (vai para 'O que já pagamos') — filtro logo abaixo, depois de ler o resultado do lote
          // nota nossa de até 90 dias (a importação histórica do fechamento não pode encher a lista), ou já em lote
          { responsavel: 'NOSSO', situacao: { in: [...SITUACOES_ABERTAS] }, OR: [{ emitidaEm: { gte: limiteNossas() } }, { guiaLoteId: { not: null } }] },
          filtroVendasMl(),
        ],
      },
      orderBy: { emitidaEm: 'desc' }, // mais recentes primeiro (pedido do José, 20/11/2026)
    }),
    prisma.difalAliquota.findMany(),
    prisma.difalEmitente.findMany(),
  ])
  // dados do envio no order-tracker (mesmo banco, só leitura): uma consulta para todas as notas
  const pedidos = await prisma.order.findMany({
    where: { orderNumber: { in: notas.map((n) => numeroDoPedido(n.empresa, n.nfNumero)) } },
    select: {
      id: true, orderNumber: true, status: true, shippedAt: true, estimatedDelivery: true, deliveredAt: true,
      lastTracking: true, hasOccurrence: true, carrier: { select: { name: true } },
    },
  })
  const envioPorPedido = new Map(pedidos.map((p) => [p.orderNumber, {
    pedidoId: p.id,
    situacao: p.status,
    transportadora: p.carrier?.name ?? null,
    enviadoEm: p.shippedAt,
    previsao: p.estimatedDelivery,
    entregueEm: p.deliveredAt,
    ultimoRastreio: p.lastTracking,
    temOcorrencia: p.hasOccurrence,
  } satisfies EnvioDaNota]))
  const porUf = new Map(aliquotas.map((a) => [a.uf, a]))
  const porEmpresa = new Map(emitentes.map((e) => [e.empresa, e]))
  const hoje = dataBR()
  // resultado do portal das guias já geradas (vendas do ML esperando comprovante)
  const lotes = await prisma.difalLoteGnre.findMany({
    where: { id: { in: notas.map((n) => n.guiaLoteId).filter((x): x is string => !!x) } },
    select: { id: true, resultadoXml: true },
  })
  const resultadoPorLote = new Map(lotes.map((l) => [l.id, l.resultadoXml]))

  return notas.map((n) => {
    const ml = n.responsavel === 'ML_PAGA'
    const faltando = n.guiaGeradaEm ? [] : oQueFalta(n, porUf.get(n.clienteUf), porEmpresa.get(n.empresa))
    // sem o número da venda não há onde anexar o comprovante: pagaríamos nós e o ML também
    if (ml && !n.guiaGeradaEm && !n.mlOrderId) faltando.push('número da venda no ML (para anexar o comprovante)')
    // regra do José (20/11/2026): todo DIFAL é pago no dia da emissão da NF, de qualquer canal
    const prazo = prazoDoDifal(n.emitidaEm)
    return {
      id: n.id,
      empresa: n.empresa,
      nfNumero: n.nfNumero,
      clienteNome: n.clienteNome,
      itens: n.itens,
      emitidaEm: n.emitidaEm,
      clienteUf: n.clienteUf,
      valorNota: n.valorNota,
      difalCalculado: n.difalCalculado,
      pronta: !n.guiaGeradaEm && faltando.length === 0,
      faltando,
      prazo,
      // com guia gerada não é atrasada: a guia já existe (venda do ML esperando o comprovante)
      atrasada: !n.guiaGeradaEm && prazo < hoje,
      ml,
      mlOrderId: n.mlOrderId,
      guiaGeradaEm: n.guiaGeradaEm,
      guiaAceita: situacaoDaGuia(n, n.guiaLoteId ? resultadoPorLote.get(n.guiaLoteId) : null) === '0',
      situacaoGuia: n.guiaLoteId ? situacaoDaGuia(n, resultadoPorLote.get(n.guiaLoteId)) : null,
      situacao: n.situacao,
      observacao: n.observacao,
      estadoComCobranca: UFS_COM_COBRANCA.includes(n.clienteUf),
      calculoDetalhe: n.calculoDetalhe,
      canal: n.canalNome,
      mlLogistica: n.mlLogistica,
      envio: envioPorPedido.get(numeroDoPedido(n.empresa, n.nfNumero)) ?? null,
      envioMl: n.mlEnvioId ? { status: n.mlEnvioStatus, substatus: n.mlEnvioSubstatus, previsao: n.mlPrevisao, lidoEm: n.mlEnvioLidoEm } : null,
    }
  })
    // a nossa com guia aceita sai de Vendas (está em 'O que já pagamos'); a do ML fica até o comprovante ser enviado
    .filter((g) => g.ml || !g.guiaAceita)
}

function aaaaMmDd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), base dos feriados móveis */
function pascoa(ano: number): Date {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451), mes = Math.floor((h + l - 7 * m + 114) / 31)
  return new Date(Date.UTC(ano, mes - 1, ((h + l - 7 * m + 114) % 31) + 1))
}

/**
 * Feriados bancários nacionais (calendário da FEBRABAN): fixos + Carnaval (segunda e terça), Sexta-feira Santa e
 * Corpus Christi. 20/11 (Consciência Negra) é feriado nacional pela Lei 14.759/2023. Feriados estaduais e
 * municipais ficam de fora.
 */
export function feriadosBancarios(ano: number): Set<string> {
  const p = pascoa(ano)
  const desloca = (dias: number) => aaaaMmDd(new Date(p.getTime() + dias * 86400000))
  const fixos = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'].map((md) => `${ano}-${md}`)
  return new Set([...fixos, desloca(-48), desloca(-47), desloca(-2), desloca(60)])
}

/** o próprio dia, se for dia útil bancário; senão, o próximo (alguns estados recusam pagamento em feriado) */
export function proximoDiaUtil(dataIso: string): string {
  let d = dataIso
  for (;;) {
    const semana = new Date(`${d}T12:00:00Z`).getUTCDay()
    if (semana !== 0 && semana !== 6 && !feriadosBancarios(Number(d.slice(0, 4))).has(d)) return d
    d = somarDias(d, 1)
  }
}

/** hora do aviso diário no WhatsApp (José, 20/11/2026: o pessoal sai às 17h, o aviso chega com 1h para pagar) */
export const HORA_ROTINA_DIFAL = 16
/**
 * Corte do dia (José, 20/11/2026): nota emitida a partir desta hora vence no próximo dia útil, porque a mercadoria
 * só sai no dia seguinte e a guia é paga antes da saída.
 */
export const HORA_CORTE_DIFAL = 17

/**
 * Dia em que o DIFAL da nota precisa estar pago: o dia da emissão (ou o próximo dia útil, se emitida a partir do
 * corte ou em fim de semana/feriado). emitidaEm guarda Brasília como se fosse UTC: as partes UTC são o horário local.
 */
export function prazoDoDifal(emitidaEm: Date): string {
  const dia = aaaaMmDd(emitidaEm)
  return proximoDiaUtil(emitidaEm.getUTCHours() >= HORA_CORTE_DIFAL ? somarDias(dia, 1) : dia)
}

/** venda do ML entra na lista se a nota tem até 30 dias (decisão do José, 20/11/2026); as mais antigas ficam com a contabilidade */
export const JANELA_ML_DIAS = 30

// nós pagamos o DIFAL das vendas do ML em todos os estados (decisão do José, 20/11/2026), dentro da janela
function vendaMlNaJanela(nota: DifalNota, hojeBr: string): boolean {
  return nota.responsavel === 'ML_PAGA' && nota.situacao !== 'DIVERGENTE'
    && aaaaMmDd(nota.emitidaEm) >= somarDias(hojeBr, -JANELA_ML_DIAS)
}

/**
 * Prazo legal para pagar sem multa e juros, pela regra da UF:
 *  - "saida": a guia acompanha a mercadoria: o prazo é o dia da nota.
 *  - "dia15": até o dia 15 do mês seguinte ao da emissão.
 * emitidaEm guarda o horário de Brasília como se fosse UTC: as partes UTC dão o dia da nota.
 */
export function prazoLegal(regra: string, emitidaEm: Date): string {
  if (regra === 'dia15') {
    return aaaaMmDd(new Date(Date.UTC(emitidaEm.getUTCFullYear(), emitidaEm.getUTCMonth() + 1, 15)))
  }
  return aaaaMmDd(emitidaEm)
}

export interface LoteGerado {
  loteId: string
  xml: string
  guias: number
  total: number
}

/**
 * Monta o lote com as notas escolhidas. Só marca as notas como "guia gerada"
 * depois que o XML passou em todas as validações.
 */
export async function gerarLoteDasNotas(prisma: PrismaClient, ids: string[], hoje = new Date()): Promise<LoteGerado> {
  if (!ids.length) throw new ErroMontagemGnre('nenhuma nota escolhida')
  if (ids.length > LIMITE_GUIAS_POR_LOTE) {
    throw new ErroMontagemGnre(`escolha no máximo ${LIMITE_GUIAS_POR_LOTE} notas por lote`)
  }

  const notas = await prisma.difalNota.findMany({ where: { id: { in: ids } } })
  if (notas.length !== ids.length) throw new ErroMontagemGnre('alguma nota escolhida não existe mais')

  const empresas = new Set(notas.map((n) => n.empresa))
  if (empresas.size !== 1) throw new ErroMontagemGnre('um lote tem notas de uma empresa só (AVIC ou AGRO)')
  const empresa = notas[0].empresa

  const jaGerada = notas.find((n) => n.guiaGeradaEm)
  if (jaGerada) throw new ErroMontagemGnre(`a nota ${jaGerada.nfNumero} já teve guia gerada (lote ${jaGerada.guiaLoteId})`)
  const hojeBr = dataBR(hoje) // dia de hoje em Brasília (o servidor roda em UTC)
  const naoNossa = notas.find((n) => !(n.difalCalculado > 0) || !(n.responsavel === 'NOSSO' || vendaMlNaJanela(n, hojeBr)))
  if (naoNossa) throw new ErroMontagemGnre(`a nota ${naoNossa.nfNumero} não é uma guia nossa (venda do ML só com até ${JANELA_ML_DIAS} dias)`)
  const semVenda = notas.find((n) => n.responsavel === 'ML_PAGA' && !n.mlOrderId)
  if (semVenda) throw new ErroMontagemGnre(`a nota ${semVenda.nfNumero} não tem o número da venda no ML: não haveria onde anexar o comprovante`)

  const [aliquotas, emitente] = await Promise.all([
    prisma.difalAliquota.findMany({ where: { uf: { in: [...new Set(notas.map((n) => n.clienteUf))] } } }),
    prisma.difalEmitente.findUnique({ where: { empresa } }),
  ])
  if (!emitente) throw new ErroMontagemGnre(`dados do emitente ${empresa} ainda não foram lidos de nenhuma nota`)
  const porUf = new Map(aliquotas.map((a) => [a.uf, a]))

  const primeiroDiaPagavel = proximoDiaUtil(hojeBr)
  const guias: GuiaGnre[] = notas.map((n) => {
    const faltando = oQueFalta(n, porUf.get(n.clienteUf), emitente)
    if (faltando.length) throw new ErroMontagemGnre(`nota ${n.nfNumero}: falta ${faltando.join('; ')}`)
    const a = porUf.get(n.clienteUf)!
    const prazo = prazoLegal(a.vencimentoRegra, n.emitidaEm)
    // paga no prazo do DIFAL (nota depois das 17h ou de fim de semana: próximo dia útil), nunca antes do primeiro dia pagável
    const prazoPagar = prazoDoDifal(n.emitidaEm)
    const dataPagamento = prazoPagar > primeiroDiaPagavel ? prazoPagar : primeiroDiaPagavel
    // nota atrasada (prazo < hoje): o José liberou com aviso na tela (20/11/2026). A guia sai só com o
    // imposto, sem multa e juros, e com vencimento no dia do pagamento (o portal exige vencimento >= pagamento).
    return {
      ufFavorecida: n.clienteUf,
      receita: a.codigoReceitaGnre!,
      ...(a.tipoDocOrigemGnre !== SEM_DOCUMENTO_ORIGEM && {
        documentoOrigem: documentoOrigem(n, a.tipoDocOrigemGnre)!,
        tipoDocumentoOrigem: a.tipoDocOrigemGnre,
      }),
      // o portal exige vencimento >= pagamento: se o prazo cai antes (venda do ML ou hoje é feriado), vence no dia do pagamento
      dataVencimento: prazo < dataPagamento ? dataPagamento : prazo,
      dataPagamento,
      camposExtras: camposExtrasDaUf(a).map((c) => ({ codigo: c.codigo, valor: valorCampoExtra(c, n)! })),
      valorPrincipal: n.difalCalculado,
      referencia: {
        // período mensal ('0', XSD dados_gnre_v2.00) só onde o estado exige: o AM recusou sem ele (220)
        ...(a.exigePeriodoGnre && { periodo: '0' }),
        mes: String(n.emitidaEm.getUTCMonth() + 1).padStart(2, '0'),
        ano: String(n.emitidaEm.getUTCFullYear()),
      },
      destinatario: {
        documento: n.documentoDestinatario!,
        razaoSocial: n.clienteNome,
        municipio: n.municipioIbgeDestino!,
      },
      // XSD dados_gnre_v2.00: identificadorGuia só aceita [0-9]{1,10}. O número da NF basta,
      // porque cada lote é de uma empresa só.
      identificadorGuia: n.nfNumero.replace(/\D/g, '').slice(-10),
    }
  })

  const xml = montarLoteGnre(guias, {
    cnpj: emitente.cnpj,
    razaoSocial: emitente.razaoSocial,
    endereco: emitente.endereco,
    municipio: emitente.municipioIbge,
    uf: emitente.uf,
    cep: emitente.cep,
    telefone: emitente.telefone ?? undefined,
  })

  const sufixo = Math.random().toString(36).slice(2, 6).toUpperCase()
  const loteId = `${empresa}-${hoje.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${sufixo}`
  const total = guias.reduce((s, g) => s + g.valorPrincipal, 0)
  // Transação: só marca notas que AINDA estão livres; se outra requisição levou alguma
  // no meio do caminho (duplo clique), a contagem não bate e tudo é desfeito.
  await prisma.$transaction(async (tx) => {
    await tx.difalLoteGnre.create({
      data: { id: loteId, empresa, ambiente: ambienteGnre(), xml, guias: guias.length, total },
    })
    const marcadas = await tx.difalNota.updateMany({
      where: { id: { in: ids }, guiaGeradaEm: null },
      data: { guiaGeradaEm: hoje, guiaLoteId: loteId },
    })
    if (marcadas.count !== ids.length) {
      throw new ErroMontagemGnre('alguma nota já entrou em outro lote neste instante; recarregue a lista e tente de novo')
    }
  })

  return { loteId, xml, guias: guias.length, total }
}
