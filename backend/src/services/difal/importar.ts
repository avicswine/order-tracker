/**
 * Importa as notas fiscais do Bling e grava o DIFAL calculado de cada uma.
 *
 * Só leitura no Bling: lista as NFs do período, busca o detalhe de cada uma
 * (que traz os itens com NCM, a UF e a inscrição estadual do destinatário) e
 * grava na tabela difal_notas com o cálculo já feito.
 *
 * Reimportar a mesma nota é seguro: a gravação é por empresa + número da nota,
 * e campos preenchidos depois (cobrança do ML, guia paga) não são apagados.
 */
import { PrismaClient } from '@prisma/client'
import { blingGet, listarEmpresasBling } from '../../routes/bling'
import { calcularDifal, type DadosNota, type RegraUf } from './calculo'
import { lerDifalDoXml, conferirComCadastro } from './xmlNota'

/** Pega o texto de uma tag dentro de um trecho do XML. */
function tagXml(trecho: string, tag: string): string | null {
  const m = trecho.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
  return m ? m[1] : null
}

/** O município vem do IBGE com 7 dígitos; a GNRE quer os 5 sem a UF. */
function municipioGnre(cMun: string | null): string | null {
  const d = (cMun ?? '').replace(/\D/g, '')
  return d.length === 7 ? d.slice(2) : null
}

/** Dados do destinatário e do emitente que a GNRE exige, lidos do XML da nota. */
function dadosGnreDoXml(xml: string) {
  const dest = xml.match(/<dest>([\s\S]*?)<\/dest>/)?.[1] ?? ''
  const enderDest = dest.match(/<enderDest>([\s\S]*?)<\/enderDest>/)?.[1] ?? ''
  const emit = xml.match(/<emit>([\s\S]*?)<\/emit>/)?.[1] ?? ''
  const enderEmit = emit.match(/<enderEmit>([\s\S]*?)<\/enderEmit>/)?.[1] ?? ''
  const logradouro = [tagXml(enderEmit, 'xLgr'), tagXml(enderEmit, 'nro'), tagXml(enderEmit, 'xCpl')]
    .filter(Boolean)
    .join(', ')
  return {
    municipioIbgeDestino: municipioGnre(tagXml(enderDest, 'cMun')),
    documentoDestinatario: tagXml(dest, 'CNPJ') ?? tagXml(dest, 'CPF'),
    emitente: emit
      ? {
          cnpj: tagXml(emit, 'CNPJ') ?? '',
          inscricaoEstadual: tagXml(emit, 'IE'),
          razaoSocial: tagXml(emit, 'xNome') ?? '',
          endereco: logradouro,
          municipioIbge: municipioGnre(tagXml(enderEmit, 'cMun')) ?? '',
          uf: tagXml(enderEmit, 'UF') ?? '',
          cep: tagXml(enderEmit, 'CEP') ?? '',
          telefone: tagXml(enderEmit, 'fone'),
        }
      : null,
  }
}

/** NF como o Bling devolve no detalhe. Só os campos que usamos. */
interface NfeBlingDetalhe {
  id?: number | string
  numero?: string | number
  serie?: string | number
  chaveAcesso?: string
  dataEmissao?: string
  /** o Bling devolve um objeto { id, descricao? } (em produção veio só com id) */
  naturezaOperacao?: string | { id?: number | string; descricao?: string }
  valorNota?: number
  valorFrete?: number
  situacao?: number
  tipo?: number
  numeroPedidoLoja?: string
  /** link assinado para baixar o XML da nota */
  xml?: string
  loja?: { id?: number }
  contato?: {
    nome?: string
    ie?: string
    endereco?: { uf?: string; endereco?: { uf?: string } }
  }
  // mesmos campos que o cmvsync já lê dos itens da NF no Bling (codigo, descricao, unidade, quantidade, valor)
  itens?: Array<{
    codigo?: string
    descricao?: string
    unidade?: string
    classificacaoFiscal?: string
    valorTotal?: number
    valor?: number
    quantidade?: number
  }>
}

/** itens da NF para o tooltip da tela (o cálculo só usa NCM e valor) */
function itensParaTela(nf: NfeBlingDetalhe) {
  return (nf.itens ?? []).map((i) => ({
    sku: i.codigo ?? null,
    descricao: i.descricao ?? null,
    ncm: i.classificacaoFiscal ?? null,
    quantidade: i.quantidade ?? null,
    unidade: i.unidade ?? null,
    valorUnitario: i.valor ?? null,
    valorTotal: i.valorTotal ?? (i.valor ?? 0) * (i.quantidade ?? 1),
  }))
}

export interface ResultadoImportacao {
  empresa: string
  lidas: number
  gravadas: number
  atualizadas: number
  ignoradas: number
  /** já estavam completas no banco: não gastamos chamada de detalhe nem XML */
  puladas: number
  erros: string[]
}

/**
 * Empresas que o monitor acompanha. A Equipage fica de fora: é outra empresa, de
 * outro sócio e outro regime tributário, e a regra do Convênio 52/91 com origem no
 * Rio Grande do Sul não vale para ela.
 */
const EMPRESAS_DO_MONITOR = ['AVIC', 'AGRO']

/**
 * Situações da NF-e no Bling que valem como nota emitida (especificação oficial,
 * schema NotasFiscaisDadosBaseDTO.situacao):
 *   1 Pendente · 2 Cancelada · 3 Aguardando recibo · 4 Rejeitada · 5 Autorizada
 *   6 Emitida DANFE · 7 Registrada · 8 Aguardando protocolo · 9 Denegada
 *   10 Consulta situação · 11 Bloqueada
 * Só 5, 6 e 7 são notas válidas perante a SEFAZ. Na prática quase todas as nossas
 * chegam como 6 — aceitar só a 5 descartava a operação inteira.
 */
const SITUACOES_EMITIDAS = new Set([5, 6, 7])
/** Tipo 1 é nota de saída. */
const TIPO_SAIDA = 1

/** Lê a UF do destinatário, que o Bling aninha de formas diferentes. */
function ufDoContato(nf: NfeBlingDetalhe): string | null {
  const e = nf.contato?.endereco
  const uf = e?.uf ?? e?.endereco?.uf
  return uf ? String(uf).trim().toUpperCase() : null
}

/** Tem inscrição estadual de verdade? "ISENTO" e vazio não contam. */
function temIe(ie?: string | null): boolean {
  const v = (ie || '').trim().toUpperCase()
  if (!v) return false
  if (v === 'ISENTO' || v === 'ISENTA') return false
  return /\d/.test(v)
}

// trava: o botão da tela e a rotina diária não podem importar ao mesmo tempo (chamadas em dobro no Bling)
let importando = false

export async function importarNotas(
  prisma: PrismaClient,
  opcoes: { empresa?: string; desde?: Date; limite?: number; forcar?: boolean } = {}
): Promise<ResultadoImportacao[]> {
  if (importando) throw new Error('já existe uma importação em andamento')
  importando = true
  try {
    return await importarNotasSemTrava(prisma, opcoes)
  } finally {
    importando = false
  }
}

async function importarNotasSemTrava(
  prisma: PrismaClient,
  opcoes: { empresa?: string; desde?: Date; limite?: number; forcar?: boolean }
): Promise<ResultadoImportacao[]> {
  const desde = opcoes.desde ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const desdeStr = desde.toISOString().slice(0, 10)

  const regras = await prisma.difalAliquota.findMany()
  const porUf = new Map<string, RegraUf>(
    regras.map((r) => [
      r.uf,
      {
        uf: r.uf,
        nome: r.nome,
        aliquotaInterna: r.aliquotaInterna,
        fcp: r.fcp,
        interestadual: r.interestadual,
        metodo: r.metodo as 'carga' | 'prop',
      },
    ])
  )

  const empresas = listarEmpresasBling()
    .filter((e) => e.connected)
    .filter((e) => EMPRESAS_DO_MONITOR.includes(e.code))
    .filter((e) => !opcoes.empresa || e.key === opcoes.empresa)

  const saida: ResultadoImportacao[] = []
  const emitenteGravado = new Set<string>()

  for (const empresa of empresas) {
    const res: ResultadoImportacao = {
      empresa: empresa.code,
      lidas: 0,
      gravadas: 0,
      atualizadas: 0,
      ignoradas: 0,
      puladas: 0,
      erros: [],
    }

    // Canais de venda desta empresa, para saber quem recolhe o DIFAL. O mapa é por
    // empresa: canal de uma não vale para a outra.
    const canais = new Map<number, { nome: string; tipo: string }>()
    let canaisOk = false
    try {
      const lista = (await blingGet(empresa.key, '/canais-venda?limite=100')) as {
        data?: Array<{ id?: number; descricao?: string; tipo?: string }>
      }
      for (const c of lista?.data ?? []) {
        if (c.id != null) canais.set(c.id, { nome: c.descricao ?? '', tipo: c.tipo ?? '' })
      }
      canaisOk = canais.size > 0
    } catch (e) {
      res.erros.push(`canais de venda: ${(e as Error).message}`)
    }
    // Sem os canais não dá para saber o que é venda do Mercado Livre, e toda nota
    // viraria "guia nossa" — fazendo o sistema mandar pagar um DIFAL que o ML já
    // recolheu. Melhor não importar nada desta empresa do que gerar obrigação falsa.
    if (!canaisOk) {
      res.erros.push(
        'não consegui ler os canais de venda: importação desta empresa foi interrompida ' +
          'para não marcar venda do Mercado Livre como guia nossa'
      )
      saida.push(res)
      continue
    }

    let pagina = 1
    while (true) {
      let lote: NfeBlingDetalhe[] = []
      try {
        const data = (await blingGet(
          empresa.key,
          `/nfe?pagina=${pagina}&limite=100&dataEmissaoInicial=${desdeStr}&tipo=${TIPO_SAIDA}`
        )) as { data?: NfeBlingDetalhe[] }
        lote = data?.data ?? []
      } catch (e) {
        res.erros.push(`página ${pagina}: ${(e as Error).message}`)
        break
      }
      if (lote.length === 0) break

      for (const resumo of lote) {
        if (opcoes.limite && res.lidas >= opcoes.limite) break
        res.lidas++

        // Nota cancelada/rejeitada/denegada DEPOIS de importada não pode continuar
        // como obrigação: zera o DIFAL; se já saiu em lote, marca para conferir.
        if (resumo.situacao !== undefined && !SITUACOES_EMITIDAS.has(resumo.situacao)) {
          const numeroResumo = String(parseInt(String(resumo.numero ?? ''), 10))
          const chave = { empresa: empresa.code, nfNumero: numeroResumo }
          const aviso = `nota com situação ${resumo.situacao} no Bling (não emitida/cancelada)`
          const semGuia = await prisma.difalNota.updateMany({
            where: { ...chave, guiaGeradaEm: null, responsavel: { not: 'SEM_DIFAL' } },
            data: { responsavel: 'SEM_DIFAL', difalCalculado: 0, difalMetodo: 'isento', situacao: 'CONFERIDO', observacao: aviso },
          })
          const comGuia = await prisma.difalNota.updateMany({
            where: { ...chave, guiaGeradaEm: { not: null }, situacao: { not: 'DIVERGENTE' } },
            data: { situacao: 'DIVERGENTE', observacao: `${aviso} — mas já saiu em lote GNRE: conferir` },
          })
          res.atualizadas += semGuia.count + comGuia.count
          res.ignoradas++
          continue
        }

        // Nota já gravada com os dados da guia não precisa de nova chamada de detalhe
        // nem de novo download do XML (cada importação refazia tudo: 2 chamadas por nota).
        if (!opcoes.forcar) {
          const completa = await prisma.difalNota.findFirst({
            where: {
              empresa: empresa.code,
              blingId: String(resumo.id),
              municipioIbgeDestino: { not: null },
              documentoDestinatario: { not: null },
            },
            select: { id: true, itens: true, difalCalculado: true },
          })
          if (completa && (completa.itens !== null || !(completa.difalCalculado > 0))) {
            res.puladas++
            continue
          }
          // nota completa com DIFAL, só sem os itens: busca o detalhe UMA vez e grava só os itens. Não recalcula
          // nada (a nota pode já estar em lote ou paga; refazer a conta mudaria o valor que saiu na guia).
          if (completa) {
            try {
              const det = (await blingGet(empresa.key, `/nfe/${resumo.id}`)) as { data?: NfeBlingDetalhe }
              await prisma.difalNota.update({ where: { id: completa.id }, data: { itens: itensParaTela(det?.data ?? resumo) } })
              res.atualizadas++
            } catch (e) {
              res.erros.push(`itens da NF ${resumo.numero}: ${String((e as Error).message).trim().split('\n').pop()}`)
            }
            continue
          }
        }

        let nf: NfeBlingDetalhe
        try {
          const det = (await blingGet(empresa.key, `/nfe/${resumo.id}`)) as { data?: NfeBlingDetalhe }
          nf = det?.data ?? resumo
        } catch (e) {
          res.erros.push(`NF ${resumo.numero}: ${(e as Error).message}`)
          continue
        }

        if (nf.situacao !== undefined && !SITUACOES_EMITIDAS.has(nf.situacao)) {
          res.ignoradas++
          continue
        }
        const uf = ufDoContato(nf)
        if (!uf) {
          res.ignoradas++
          continue
        }

        const canal = nf.loja?.id ? canais.get(nf.loja.id) : undefined
        const itens = (nf.itens ?? []).map((i) => ({
          ncm: i.classificacaoFiscal ?? null,
          valorTotal: i.valorTotal ?? (i.valor ?? 0) * (i.quantidade ?? 1),
        }))

        const dados: DadosNota = {
          ufDestino: uf,
          temInscricaoEstadual: temIe(nf.contato?.ie),
          canalTipo: canal?.tipo ?? null,
          itens,
          valorFrete: nf.valorFrete ?? 0,
        }
        const calc = calcularDifal(dados, porUf.get(uf))
        const erroCalculo = (calc.detalhe as { erro?: string }).erro ?? null
        if (erroCalculo) res.erros.push(`NF ${resumo.numero}: ${erroCalculo}`)
        const valorProdutos = itens.reduce((a, i) => a + i.valorTotal, 0)
        // itens para o tooltip da tela (o cálculo acima só usa NCM e valor)
        const itensNota = itensParaTela(nf)

        // O XML diz qual alíquota e qual redução o emissor usou de fato. Serve para
        // conferir a nossa tabela: divergência aqui costuma ser tabela desatualizada.
        let avisoXml: string | null = null
        let paraGuia: ReturnType<typeof dadosGnreDoXml> | null = null
        if (nf.xml) {
          try {
            // sem timeout, um download travado para a importação inteira
            const resp = await fetch(nf.xml, { signal: AbortSignal.timeout(15000) })
            if (resp.ok) {
              const textoXml = await resp.text()
              paraGuia = dadosGnreDoXml(textoXml)
              const doXml = lerDifalDoXml(textoXml)
              const regra = porUf.get(uf)
              if (regra) {
                const { avisos } = conferirComCadastro(doXml, regra)
                if (avisos.length) avisoXml = avisos.join('; ')
              }
            }
          } catch (e) {
            // o XML é conferência extra: se não vier, o cálculo segue valendo
            res.erros.push(`XML da NF ${resumo.numero}: ${(e as Error).message}`)
          }
        }
        const bruto = parseInt(String(nf.numero ?? resumo.numero ?? ''), 10)
        if (!Number.isFinite(bruto) || bruto <= 0) {
          res.erros.push(`NF sem número utilizável (id ${resumo.id})`)
          continue
        }
        const numero = String(bruto)

        // nossos dados como a GNRE pede, vindos do XML da própria nota
        if (paraGuia?.emitente && paraGuia.emitente.cnpj && !emitenteGravado.has(empresa.code)) {
          try {
            await prisma.difalEmitente.upsert({
              where: { empresa: empresa.code },
              create: { empresa: empresa.code, ...paraGuia.emitente },
              update: paraGuia.emitente,
            })
            emitenteGravado.add(empresa.code)
          } catch (e) {
            res.erros.push(`emitente ${empresa.code}: ${(e as Error).message}`)
          }
        }

        const registro = {
          empresa: empresa.code,
          // só sobrescreve quando o XML veio; senão preserva o que já foi lido antes
          ...(paraGuia
            ? { municipioIbgeDestino: paraGuia.municipioIbgeDestino, documentoDestinatario: paraGuia.documentoDestinatario }
            : {}),
          nfNumero: numero,
          nfSerie: nf.serie != null ? String(nf.serie) : null,
          nfChave: nf.chaveAcesso || null,
          blingId: nf.id != null ? String(nf.id) : null,
          emitidaEm: nf.dataEmissao ? new Date(nf.dataEmissao) : new Date(),
          naturezaOperacao:
            typeof nf.naturezaOperacao === 'string' ? nf.naturezaOperacao : nf.naturezaOperacao?.descricao ?? null,
          clienteNome: nf.contato?.nome ?? 'Não informado',
          clienteUf: uf,
          clienteTemIe: dados.temInscricaoEstadual,
          clienteIe: nf.contato?.ie ?? null,
          valorProdutos,
          valorFrete: nf.valorFrete ?? 0,
          valorNota: nf.valorNota ?? valorProdutos + (nf.valorFrete ?? 0),
          valorComReducao: calc.valorComReducao,
          valorSemReducao: calc.valorSemReducao,
          canalId: nf.loja?.id != null ? String(nf.loja.id) : null,
          canalNome: canal?.nome ?? (nf.loja?.id ? null : 'Balcão'),
          canalTipo: canal?.tipo ?? null,
          mlOrderId: nf.numeroPedidoLoja || null,
          difalCalculado: calc.difal,
          difalMetodo: calc.metodo,
          calculoDetalhe: calc.detalhe as object,
          itens: itensNota,
          responsavel: calc.responsavel,
          // só sobrescreve quando o XML respondeu; senão preserva o aviso anterior
          ...(avisoXml !== null ? { observacao: avisoXml } : {}),
          // erro de cálculo nunca fica escondido: a nota vai para "conferir" com o motivo
          ...(erroCalculo ? { situacao: 'DIVERGENTE' as const, observacao: `CÁLCULO: ${erroCalculo}` } : {}),
        }

        try {
          const existente = await prisma.difalNota.findUnique({
            where: { empresa_nfNumero: { empresa: empresa.code, nfNumero: numero } },
            select: { id: true },
          })
          if (existente) {
            // não toca no que foi conferido depois (cobrança do ML, guia paga)
            await prisma.difalNota.update({ where: { id: existente.id }, data: registro })
            res.atualizadas++
          } else {
            await prisma.difalNota.create({ data: registro })
            res.gravadas++
          }
        } catch (e) {
          // só a última linha: o Prisma repete o registro inteiro (com CPF) na mensagem
          const ultimaLinha = String((e as Error).message).trim().split('\n').pop() ?? 'erro'
          res.erros.push(`gravar NF ${numero}: ${ultimaLinha}`)
        }
      }

      if (opcoes.limite && res.lidas >= opcoes.limite) break
      if (lote.length < 100) break
      pagina++
    }

    saida.push(res)
  }

  return saida
}
