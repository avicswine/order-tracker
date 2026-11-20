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
import type { PrismaClient, DifalNota, DifalAliquota, DifalEmitente } from '@prisma/client'
import { montarLoteGnre, ErroMontagemGnre, LIMITE_GUIAS_POR_LOTE, type GuiaGnre } from './gnre'
import { ambienteGnre } from './portalGnre'

export interface GuiaPendente {
  id: string
  empresa: string
  nfNumero: string
  emitidaEm: Date
  clienteUf: string
  difalCalculado: number
  /** tudo pronto para entrar no lote */
  pronta: boolean
  /** o que ainda falta, em linguagem simples */
  faltando: string[]
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

/** data da nota no fuso de Brasília, AAAA-MM-DD (emitidaEm é guardado em UTC) */
function dataEmissaoBrasil(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

function valorCampoExtra(c: CampoExtraUf, nota: DifalNota): string | null {
  if (c.conteudo === 'chaveNfe') return nota.nfChave
  if (c.conteudo === 'dataEmissao') return dataEmissaoBrasil(nota.emitidaEm)
  if (c.conteudo === 'observacao') return `DIFAL NF ${nota.nfNumero.replace(/^0+/, '')}`.slice(0, TAMANHO_OBSERVACAO)
  return null
}

function camposExtrasDaUf(aliquota: DifalAliquota): CampoExtraUf[] {
  return Array.isArray(aliquota.camposExtrasGnre) ? (aliquota.camposExtrasGnre as unknown as CampoExtraUf[]) : []
}

/** tipoDocOrigemGnre vazio = a UF não exige documento de origem para a receita (GnreConfigUF) */
const SEM_DOCUMENTO_ORIGEM = ''

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
  for (const c of aliquota ? camposExtrasDaUf(aliquota) : []) {
    if (c.conteudo === 'desconhecido') f.push(`campo extra "${c.titulo}" (código ${c.codigo}) que o sistema não sabe preencher`)
    else if (!valorCampoExtra(c, nota)) f.push(`${c.titulo} para o campo extra ${c.codigo} (reimportar a nota)`)
  }
  return f
}

const SITUACOES_ABERTAS = ['PENDENTE', 'ATRASADO'] as const

export async function listarGuiasPendentes(prisma: PrismaClient, empresa?: string): Promise<GuiaPendente[]> {
  const [notas, aliquotas, emitentes] = await Promise.all([
    prisma.difalNota.findMany({
      where: {
        responsavel: 'NOSSO',
        situacao: { in: [...SITUACOES_ABERTAS] },
        difalCalculado: { gt: 0 },
        guiaGeradaEm: null,
        ...(empresa && { empresa }),
      },
      orderBy: { emitidaEm: 'asc' },
    }),
    prisma.difalAliquota.findMany(),
    prisma.difalEmitente.findMany(),
  ])
  const porUf = new Map(aliquotas.map((a) => [a.uf, a]))
  const porEmpresa = new Map(emitentes.map((e) => [e.empresa, e]))

  return notas.map((n) => {
    const faltando = oQueFalta(n, porUf.get(n.clienteUf), porEmpresa.get(n.empresa))
    return {
      id: n.id,
      empresa: n.empresa,
      nfNumero: n.nfNumero,
      emitidaEm: n.emitidaEm,
      clienteUf: n.clienteUf,
      difalCalculado: n.difalCalculado,
      pronta: faltando.length === 0,
      faltando,
    }
  })
}

function aaaaMmDd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Vencimento conforme a regra da UF:
 *  - "saida": a guia deveria acompanhar a mercadoria; como a nota já saiu, vence hoje.
 *  - "dia15": até o dia 15 do mês seguinte ao da emissão.
 */
function vencimento(regra: string, emitidaEm: Date, hoje: Date): string {
  if (regra === 'dia15') {
    return aaaaMmDd(new Date(Date.UTC(emitidaEm.getUTCFullYear(), emitidaEm.getUTCMonth() + 1, 15)))
  }
  return aaaaMmDd(hoje)
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
  const naoNossa = notas.find((n) => n.responsavel !== 'NOSSO' || !(n.difalCalculado > 0))
  if (naoNossa) throw new ErroMontagemGnre(`a nota ${naoNossa.nfNumero} não é uma guia nossa`)

  const [aliquotas, emitente] = await Promise.all([
    prisma.difalAliquota.findMany({ where: { uf: { in: [...new Set(notas.map((n) => n.clienteUf))] } } }),
    prisma.difalEmitente.findUnique({ where: { empresa } }),
  ])
  if (!emitente) throw new ErroMontagemGnre(`dados do emitente ${empresa} ainda não foram lidos de nenhuma nota`)
  const porUf = new Map(aliquotas.map((a) => [a.uf, a]))

  const guias: GuiaGnre[] = notas.map((n) => {
    const faltando = oQueFalta(n, porUf.get(n.clienteUf), emitente)
    if (faltando.length) throw new ErroMontagemGnre(`nota ${n.nfNumero}: falta ${faltando.join('; ')}`)
    const a = porUf.get(n.clienteUf)!
    return {
      ufFavorecida: n.clienteUf,
      receita: a.codigoReceitaGnre!,
      ...(a.tipoDocOrigemGnre !== SEM_DOCUMENTO_ORIGEM && {
        documentoOrigem: documentoOrigem(n, a.tipoDocOrigemGnre)!,
        tipoDocumentoOrigem: a.tipoDocOrigemGnre,
      }),
      dataVencimento: vencimento(a.vencimentoRegra, n.emitidaEm, hoje),
      dataPagamento: aaaaMmDd(hoje),
      camposExtras: camposExtrasDaUf(a).map((c) => ({ codigo: c.codigo, valor: valorCampoExtra(c, n)! })),
      valorPrincipal: n.difalCalculado,
      referencia: {
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
