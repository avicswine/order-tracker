import { blingGet } from '../../routes/bling'
import type { BlingSeparacaoAdapter, CatalogoItem, NfItemBruto, NfResumo, ProdutoResumo } from './bling-tipos'
import { parseDataBling } from './datas'

// Implementação real sobre a API Bling v3, usando o cliente/tokens já existentes do order-tracker.
// Só LEITURA. Nomes de campos conforme a spec OpenAPI oficial (developer.bling.com.br/referencia).

const LIMITE_PAGINA = 100
const MAX_PAGINAS = 50
const PAUSA_ENTRE_PAGINAS_MS = 200 // Bling limita ~3 req/s
const CACHE_CANAIS_MS = 60 * 60 * 1000

// Situações da NF-e no Bling: 1 Pendente, 2 Cancelada, 3 Aguardando recibo, 4 Rejeitada, 5 Autorizada,
// 6 Emitida DANFE, 7 Registrada, 8 Aguardando protocolo, 9 Denegada, 10 Consulta situação, 11 Bloqueada
const NF_SITUACAO_CANCELADA = 2
const NF_SITUACOES_DESCARTADAS = new Set([4, 9, 11]) // rejeitada, denegada, bloqueada
const NF_TIPO_SAIDA = '1'
const PRODUTO_CRITERIO_TODOS = '5'

const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))

interface NfeLista {
  id: number | string
  tipo?: number
  situacao?: number
  numero?: number | string
  serie?: number | string
  dataEmissao?: string
  contato?: { nome?: string }
  loja?: { id?: number | string }
  valorNota?: number
  chaveAcesso?: string
}

interface NfeDetalhe extends NfeLista {
  itens?: Array<{
    codigo?: string
    descricao?: string
    quantidade?: number | string
    pesoBruto?: number
    pesoLiquido?: number
  }>
}

interface ProdutoBling {
  id: number | string
  nome?: string
  codigo?: string
  formato?: string           // S simples | V com variações | E com composição
  pesoLiquido?: number
  pesoBruto?: number
  imagemURL?: string
  midia?: { imagens?: { imagensURL?: Array<{ link?: string }>; externas?: Array<{ link?: string }>; internas?: Array<{ link?: string }> } }
  estrutura?: { componentes?: Array<{ produto?: { id?: number | string }; quantidade?: number | string }> }
}

interface CanalVenda { id: number | string; descricao?: string }

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// ---- cache de canais de venda (id → descrição) por empresa ----
const canaisCache = new Map<string, { em: number; mapa: Map<string, string> }>()

async function nomeCanal(companyKey: string, lojaId: string | number | undefined): Promise<string | undefined> {
  if (lojaId === undefined || lojaId === null || lojaId === 0 || lojaId === '0') return undefined
  const agora = Date.now()
  let cache = canaisCache.get(companyKey)
  if (!cache || agora - cache.em > CACHE_CANAIS_MS) {
    const mapa = new Map<string, string>()
    try {
      for (let pagina = 1; pagina <= 5; pagina++) {
        const resp = (await blingGet(companyKey, `/canais-venda?pagina=${pagina}&limite=${LIMITE_PAGINA}`)) as { data?: CanalVenda[] }
        const lote = resp.data ?? []
        for (const c of lote) mapa.set(String(c.id), c.descricao || `Canal ${c.id}`)
        if (lote.length < LIMITE_PAGINA) break
      }
    } catch (err) {
      console.warn('[Separação] Não foi possível listar canais de venda:', err instanceof Error ? err.message : err)
    }
    cache = { em: agora, mapa }
    canaisCache.set(companyKey, cache)
  }
  return cache.mapa.get(String(lojaId)) ?? `Loja ${lojaId}`
}

async function paraNfResumo(companyKey: string, nf: NfeLista): Promise<NfResumo> {
  return {
    blingNfId: String(nf.id),
    numero: String(nf.numero ?? ''),
    serie: nf.serie !== undefined && nf.serie !== null ? String(nf.serie) : undefined,
    chaveAcesso: nf.chaveAcesso || undefined,
    emitidaEm: parseDataBling(nf.dataEmissao),
    clienteNome: nf.contato?.nome || 'Cliente não informado',
    valorNota: num(nf.valorNota),
    canal: await nomeCanal(companyKey, nf.loja?.id),
    cancelada: num(nf.situacao) === NF_SITUACAO_CANCELADA,
  }
}

function paraProdutoResumo(p: ProdutoBling): ProdutoResumo {
  const imagens = p.midia?.imagens
  const foto = p.imagemURL || imagens?.imagensURL?.[0]?.link || imagens?.externas?.[0]?.link || imagens?.internas?.[0]?.link || undefined
  const componentes = (p.estrutura?.componentes ?? [])
    .map(c => ({ produtoId: c.produto?.id !== undefined ? String(c.produto.id) : '', quantidade: num(c.quantidade) ?? 1 }))
    .filter(c => c.produtoId)
  const peso = num(p.pesoBruto) || num(p.pesoLiquido)
  return {
    id: String(p.id),
    sku: p.codigo || `ID-${p.id}`,
    nome: p.nome || `Produto ${p.id}`,
    fotoUrl: foto,
    pesoUnit: peso && peso > 0 ? peso : undefined,
    componentes,
  }
}

async function listarNfsPaginado(companyKey: string, params: Record<string, string>): Promise<NfeLista[]> {
  const todas: NfeLista[] = []
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const qs = new URLSearchParams({ ...params, pagina: String(pagina), limite: String(LIMITE_PAGINA) })
    const resp = (await blingGet(companyKey, `/nfe?${qs}`)) as { data?: NfeLista[] }
    const lote = resp.data ?? []
    todas.push(...lote)
    if (lote.length < LIMITE_PAGINA) break
    await pausa(PAUSA_ENTRE_PAGINAS_MS)
  }
  return todas
}

export const blingReal: BlingSeparacaoAdapter = {
  async listarNfs(companyKey, dataInicial, dataFinal) {
    const base = {
      tipo: NF_TIPO_SAIDA,
      dataEmissaoInicial: `${dataInicial} 00:00:00`,
      dataEmissaoFinal: `${dataFinal} 23:59:59`,
    }
    // Sem "situacao" o Bling NÃO devolve canceladas → segunda consulta só com situacao=2,
    // para conseguir cancelar tarefas de NFs canceladas depois de emitidas.
    const ativas = await listarNfsPaginado(companyKey, base)
    await pausa(PAUSA_ENTRE_PAGINAS_MS)
    const canceladas = await listarNfsPaginado(companyKey, { ...base, situacao: String(NF_SITUACAO_CANCELADA) })

    const resultado: NfResumo[] = []
    for (const nf of [...ativas, ...canceladas]) {
      const situacao = num(nf.situacao)
      if (situacao !== undefined && NF_SITUACOES_DESCARTADAS.has(situacao)) continue
      resultado.push(await paraNfResumo(companyKey, nf))
    }
    return resultado
  },

  async obterItensNf(companyKey, blingNfId) {
    const resp = (await blingGet(companyKey, `/nfe/${blingNfId}`)) as { data?: NfeDetalhe }
    const itens = resp.data?.itens ?? []
    return itens.map((i): NfItemBruto => ({
      sku: (i.codigo || '').trim(),
      descricao: i.descricao || '',
      quantidade: num(i.quantidade) ?? 0,
      pesoBruto: num(i.pesoBruto),
      pesoLiquido: num(i.pesoLiquido),
    })).filter(i => i.quantidade > 0)
  },

  async obterProdutoPorSku(companyKey, sku) {
    const alvo = sku.trim()
    const qs = new URLSearchParams({ pagina: '1', limite: '10', criterio: PRODUTO_CRITERIO_TODOS })
    qs.append('codigos[]', alvo)
    const resp = (await blingGet(companyKey, `/produtos?${qs}`)) as { data?: ProdutoBling[] }
    const achado = (resp.data ?? []).find(p => (p.codigo || '').trim().toLowerCase() === alvo.toLowerCase())
    if (!achado) return null
    // A listagem não traz estrutura (kit) nem peso → busca o detalhe
    return blingReal.obterProdutoPorId(companyKey, String(achado.id))
  },

  async obterProdutoPorId(companyKey, id) {
    try {
      const resp = (await blingGet(companyKey, `/produtos/${id}`)) as { data?: ProdutoBling }
      return resp.data ? paraProdutoResumo(resp.data) : null
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 404) return null
      throw err
    }
  },

  async listarCatalogo(companyKey) {
    const resultado: CatalogoItem[] = []
    for (let pagina = 1; pagina <= MAX_PAGINAS * 4; pagina++) {
      const qs = new URLSearchParams({ pagina: String(pagina), limite: String(LIMITE_PAGINA), criterio: PRODUTO_CRITERIO_TODOS })
      const resp = (await blingGet(companyKey, `/produtos?${qs}`)) as { data?: ProdutoBling[] }
      const lote = resp.data ?? []
      for (const p of lote) resultado.push({ id: String(p.id), sku: p.codigo || `ID-${p.id}`, nome: p.nome || '' })
      if (lote.length < LIMITE_PAGINA) break
      await pausa(PAUSA_ENTRE_PAGINAS_MS)
    }
    return resultado
  },
}
