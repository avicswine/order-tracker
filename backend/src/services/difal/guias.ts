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

function oQueFalta(nota: DifalNota, aliquota: DifalAliquota | undefined, emitente: DifalEmitente | undefined): string[] {
  const f: string[] = []
  if (!nota.municipioIbgeDestino) f.push('município do destinatário (reimportar a nota para ler o XML)')
  if (!nota.documentoDestinatario) f.push('CPF/CNPJ do destinatário (reimportar a nota para ler o XML)')
  if (!aliquota?.codigoReceitaGnre) f.push(`código de receita GNRE de ${nota.clienteUf} (vem do GnreConfigUF)`)
  if (!emitente) f.push(`dados do emitente ${nota.empresa} (reimportar uma nota da empresa)`)
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
      documentoOrigem: n.nfNumero,
      tipoDocumentoOrigem: a.tipoDocOrigemGnre,
      dataVencimento: vencimento(a.vencimentoRegra, n.emitidaEm, hoje),
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
      identificadorGuia: `${n.empresa}-NF-${n.nfNumero}`,
    }
  })

  const xml = montarLoteGnre(guias, {
    cnpj: emitente.cnpj,
    inscricaoEstadual: emitente.inscricaoEstadual ?? undefined,
    razaoSocial: emitente.razaoSocial,
    endereco: emitente.endereco,
    municipio: emitente.municipioIbge,
    uf: emitente.uf,
    cep: emitente.cep,
    telefone: emitente.telefone ?? undefined,
  })

  const loteId = `${empresa}-${hoje.toISOString().replace(/[-:T]/g, '').slice(0, 14)}`
  const total = guias.reduce((s, g) => s + g.valorPrincipal, 0)
  await prisma.$transaction([
    prisma.difalLoteGnre.create({
      data: { id: loteId, empresa, ambiente: ambienteGnre(), xml, guias: guias.length, total },
    }),
    prisma.difalNota.updateMany({
      where: { id: { in: ids } },
      data: { guiaGeradaEm: hoje, guiaLoteId: loteId },
    }),
  ])

  return { loteId, xml, guias: guias.length, total }
}
