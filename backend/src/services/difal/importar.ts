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
  naturezaOperacao?: string
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
  itens?: Array<{ classificacaoFiscal?: string; valorTotal?: number; valor?: number; quantidade?: number }>
}

export interface ResultadoImportacao {
  empresa: string
  lidas: number
  gravadas: number
  atualizadas: number
  ignoradas: number
  erros: string[]
}

/**
 * Empresas que o monitor acompanha. A Equipage fica de fora: é outra empresa, de
 * outro sócio e outro regime tributário, e a regra do Convênio 52/91 com origem no
 * Rio Grande do Sul não vale para ela.
 */
const EMPRESAS_DO_MONITOR = ['AVIC', 'AGRO']

/** Situação 5 no Bling é nota autorizada; as demais não geram DIFAL. */
const SITUACAO_AUTORIZADA = 5
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

export async function importarNotas(
  prisma: PrismaClient,
  opcoes: { empresa?: string; desde?: Date; limite?: number } = {}
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

        let nf: NfeBlingDetalhe
        try {
          const det = (await blingGet(empresa.key, `/nfe/${resumo.id}`)) as { data?: NfeBlingDetalhe }
          nf = det?.data ?? resumo
        } catch (e) {
          res.erros.push(`NF ${resumo.numero}: ${(e as Error).message}`)
          continue
        }

        if (nf.situacao !== undefined && nf.situacao !== SITUACAO_AUTORIZADA) {
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
        const valorProdutos = itens.reduce((a, i) => a + i.valorTotal, 0)

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
          municipioIbgeDestino: paraGuia?.municipioIbgeDestino ?? null,
          documentoDestinatario: paraGuia?.documentoDestinatario ?? null,
          nfNumero: numero,
          nfSerie: nf.serie != null ? String(nf.serie) : null,
          nfChave: nf.chaveAcesso || null,
          blingId: nf.id != null ? String(nf.id) : null,
          emitidaEm: nf.dataEmissao ? new Date(nf.dataEmissao) : new Date(),
          naturezaOperacao: nf.naturezaOperacao ?? null,
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
          responsavel: calc.responsavel,
          // só sobrescreve quando o XML respondeu; senão preserva o aviso anterior
          ...(avisoXml !== null ? { observacao: avisoXml } : {}),
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
          res.erros.push(`gravar NF ${numero}: ${(e as Error).message}`)
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
