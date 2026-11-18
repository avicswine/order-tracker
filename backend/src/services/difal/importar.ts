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

  const canais = new Map<number, { nome: string; tipo: string }>()
  const empresas = listarEmpresasBling()
    .filter((e) => e.connected)
    .filter((e) => !opcoes.empresa || e.key === opcoes.empresa)

  const saida: ResultadoImportacao[] = []

  for (const empresa of empresas) {
    const res: ResultadoImportacao = {
      empresa: empresa.code,
      lidas: 0,
      gravadas: 0,
      atualizadas: 0,
      ignoradas: 0,
      erros: [],
    }

    // canais de venda da empresa, para saber quem recolhe o DIFAL
    try {
      const lista = (await blingGet(empresa.key, '/canais-venda?limite=100')) as {
        data?: Array<{ id?: number; descricao?: string; tipo?: string }>
      }
      for (const c of lista?.data ?? []) {
        if (c.id != null) canais.set(c.id, { nome: c.descricao ?? '', tipo: c.tipo ?? '' })
      }
    } catch (e) {
      res.erros.push(`canais de venda: ${(e as Error).message}`)
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
        if (nf.xml) {
          try {
            const resp = await fetch(nf.xml)
            if (resp.ok) {
              const doXml = lerDifalDoXml(await resp.text())
              const regra = porUf.get(uf)
              if (regra) {
                const { avisos } = conferirComCadastro(doXml, regra)
                if (avisos.length) avisoXml = avisos.join('; ')
              }
            }
          } catch {
            // o XML é conferência extra: se não vier, o cálculo segue valendo
          }
        }
        const numero = String(parseInt(String(nf.numero ?? resumo.numero ?? '0'), 10))

        const registro = {
          empresa: empresa.code,
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
          observacao: avisoXml,
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
