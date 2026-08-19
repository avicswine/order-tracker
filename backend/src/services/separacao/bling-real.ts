import { blingGet } from '../../routes/bling'
import type { BlingSeparacaoAdapter, CatalogoItem, DiagnosticoRecurso, NfItemBruto, NfResumo, ProdutoResumo } from './bling-tipos'
import { dataBR, parseDataBling, somarDias } from './datas'

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
const BUSCA_NUMERO_BLOCOS = 4 // fallback da busca por número: ~4 meses para trás, em blocos de 31 dias

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

function statusHttp(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status
}

// ---- permissão de /produtos ----
// Se o app do Bling não tiver o escopo "Produtos", o Bling devolve 403. Em vez de travar a separação,
// seguimos só com os itens da NF (sem kits/fotos/peso) e lembramos por 1h para não insistir a cada SKU.
const BLOQUEIO_PRODUTOS_MS = 60 * 60 * 1000
const produtos403 = new Map<string, number>()
function produtosBloqueado(companyKey: string): boolean {
  const em = produtos403.get(companyKey)
  if (!em) return false
  if (Date.now() - em > BLOQUEIO_PRODUTOS_MS) { produtos403.delete(companyKey); return false }
  return true
}
function marcarProdutosBloqueado(companyKey: string) {
  if (!produtos403.has(companyKey)) {
    console.warn(`[Separação] Bling recusou /produtos (403) para ${companyKey} — seguindo sem cadastro de produtos (sem kits/fotos). Adicione o escopo "Produtos" no app do Bling e reconecte a empresa.`)
  }
  produtos403.set(companyKey, Date.now())
}
export function produtosIndisponiveis(companyKey: string): boolean {
  return produtosBloqueado(companyKey)
}

// ---- cache de canais de venda (id → descrição) por empresa ----
// Falha (ex.: 403 sem escopo) é lembrada por pouco tempo, para voltar a funcionar assim que o escopo for liberado.
const CACHE_CANAIS_FALHA_MS = 5 * 60 * 1000
const canaisCache = new Map<string, { em: number; mapa: Map<string, string>; falhou: boolean }>()

async function nomeCanal(companyKey: string, lojaId: string | number | undefined): Promise<string | undefined> {
  if (lojaId === undefined || lojaId === null || lojaId === 0 || lojaId === '0') return undefined
  const agora = Date.now()
  let cache = canaisCache.get(companyKey)
  const validade = cache?.falhou ? CACHE_CANAIS_FALHA_MS : CACHE_CANAIS_MS
  if (!cache || agora - cache.em > validade) {
    const mapa = new Map<string, string>()
    let falhou = false
    try {
      for (let pagina = 1; pagina <= 5; pagina++) {
        const resp = (await blingGet(companyKey, `/canais-venda?pagina=${pagina}&limite=${LIMITE_PAGINA}`)) as { data?: CanalVenda[] }
        const lote = resp.data ?? []
        for (const c of lote) mapa.set(String(c.id), c.descricao || `Canal ${c.id}`)
        if (lote.length < LIMITE_PAGINA) break
      }
    } catch (err) {
      falhou = true
      console.warn('[Separação] Não foi possível listar canais de venda:', err instanceof Error ? err.message : err)
    }
    cache = { em: agora, mapa, falhou }
    canaisCache.set(companyKey, cache)
  }
  return cache.mapa.get(String(lojaId)) ?? `Loja ${lojaId}`
}

// ---- cache de produtos (por empresa) — kits repetem os mesmos componentes NF após NF ----
const CACHE_PRODUTOS_MS = 10 * 60 * 1000
const produtosPorId = new Map<string, { em: number; p: ProdutoResumo | null }>()
const produtoIdPorSku = new Map<string, { em: number; id: string | null }>()
const chaveCache = (companyKey: string, k: string) => `${companyKey}|${k.trim().toLowerCase()}`
function lerCache<T>(mapa: Map<string, { em: number } & T>, chave: string): (T & { em: number }) | undefined {
  const v = mapa.get(chave)
  if (!v) return undefined
  if (Date.now() - v.em > CACHE_PRODUTOS_MS) { mapa.delete(chave); return undefined }
  return v
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

  async buscarNfPorNumero(companyKey, numero) {
    const digitos = numero.replace(/\D/g, '')
    if (!digitos) return []
    const semZeros = String(parseInt(digitos, 10))
    if (semZeros === 'NaN') return []

    const mesmoNumero = (nf: NfeLista) => String(parseInt(String(nf.numero ?? '0').replace(/\D/g, ''), 10)) === semZeros
    const converter = async (lista: NfeLista[]) => {
      const r: NfResumo[] = []
      for (const nf of lista) {
        if (!mesmoNumero(nf)) continue
        const situacao = num(nf.situacao)
        if (situacao !== undefined && NF_SITUACOES_DESCARTADAS.has(situacao)) continue
        r.push(await paraNfResumo(companyKey, nf))
      }
      return r
    }

    // 1) Filtro direto por número (nem toda conta do Bling responde a ele)
    for (const v of [...new Set([semZeros, digitos, semZeros.padStart(9, '0')])]) {
      const lista = await listarNfsPaginado(companyKey, { tipo: NF_TIPO_SAIDA, numero: v })
      const achados = await converter(lista)
      if (achados.length > 0) return achados
      await pausa(PAUSA_ENTRE_PAGINAS_MS)
    }

    // 2) Fallback: varre períodos retroativos (blocos de 31 dias) e filtra pelo número.
    //    Mais lento, mas funciona quando o filtro "numero" é ignorado pela API.
    const hoje = dataBR()
    for (let bloco = 0; bloco < BUSCA_NUMERO_BLOCOS; bloco++) {
      const dataFinal = somarDias(hoje, -bloco * 31)
      const dataInicial = somarDias(dataFinal, -30)
      const lista = await listarNfsPaginado(companyKey, {
        tipo: NF_TIPO_SAIDA,
        dataEmissaoInicial: `${dataInicial} 00:00:00`,
        dataEmissaoFinal: `${dataFinal} 23:59:59`,
      })
      const achados = await converter(lista)
      if (achados.length > 0) return achados
      await pausa(PAUSA_ENTRE_PAGINAS_MS)
    }
    return []
  },

  async obterDetalheNf(companyKey, blingNfId) {
    const resp = (await blingGet(companyKey, `/nfe/${blingNfId}`)) as { data?: NfeDetalhe }
    const d = resp.data
    const itens = (d?.itens ?? []).map((i): NfItemBruto => ({
      sku: (i.codigo || '').trim(),
      descricao: i.descricao || '',
      quantidade: num(i.quantidade) ?? 0,
      pesoBruto: num(i.pesoBruto),
      pesoLiquido: num(i.pesoLiquido),
    })).filter(i => i.quantidade > 0)
    return {
      serie: d?.serie !== undefined && d?.serie !== null ? String(d.serie) : undefined,
      valorNota: num(d?.valorNota),
      chaveAcesso: d?.chaveAcesso || undefined,
      itens,
    }
  },

  async obterProdutoPorSku(companyKey, sku) {
    if (produtosBloqueado(companyKey)) return null
    const alvo = sku.trim()
    const emCache = lerCache(produtoIdPorSku, chaveCache(companyKey, alvo))
    if (emCache) return emCache.id ? blingReal.obterProdutoPorId(companyKey, emCache.id) : null

    const qs = new URLSearchParams({ pagina: '1', limite: '10', criterio: PRODUTO_CRITERIO_TODOS })
    qs.append('codigos[]', alvo)
    try {
      const resp = (await blingGet(companyKey, `/produtos?${qs}`)) as { data?: ProdutoBling[] }
      const achado = (resp.data ?? []).find(p => (p.codigo || '').trim().toLowerCase() === alvo.toLowerCase())
      produtoIdPorSku.set(chaveCache(companyKey, alvo), { em: Date.now(), id: achado ? String(achado.id) : null })
      if (!achado) return null
      // A listagem não traz estrutura (kit) nem peso → busca o detalhe
      return blingReal.obterProdutoPorId(companyKey, String(achado.id))
    } catch (err) {
      if (statusHttp(err) === 403) { marcarProdutosBloqueado(companyKey); return null }
      throw err
    }
  },

  async obterProdutoPorId(companyKey, id) {
    if (produtosBloqueado(companyKey)) return null
    const emCache = lerCache(produtosPorId, chaveCache(companyKey, id))
    if (emCache) return emCache.p
    try {
      const resp = (await blingGet(companyKey, `/produtos/${id}`)) as { data?: ProdutoBling }
      const p = resp.data ? paraProdutoResumo(resp.data) : null
      produtosPorId.set(chaveCache(companyKey, id), { em: Date.now(), p })
      if (p) produtoIdPorSku.set(chaveCache(companyKey, p.sku), { em: Date.now(), id: p.id })
      return p
    } catch (err) {
      const status = statusHttp(err)
      if (status === 404) { produtosPorId.set(chaveCache(companyKey, id), { em: Date.now(), p: null }); return null }
      if (status === 403) { marcarProdutosBloqueado(companyKey); return null }
      throw err
    }
  },

  async diagnosticar(companyKey) {
    const testes: Array<[DiagnosticoRecurso['recurso'], string]> = [
      ['nfe', '/nfe?pagina=1&limite=1'],
      ['produtos', '/produtos?pagina=1&limite=1'],
      ['canais-venda', '/canais-venda?pagina=1&limite=1'],
    ]
    const resultado: DiagnosticoRecurso[] = []
    for (const [recurso, path] of testes) {
      try {
        await blingGet(companyKey, path, 1)
        resultado.push({ recurso, ok: true })
        if (recurso === 'produtos') produtos403.delete(companyKey) // permissão voltou → libera
      } catch (err) {
        const status = statusHttp(err)
        resultado.push({ recurso, ok: false, status, detalhe: status === 403 ? 'Sem permissão — adicione o escopo no app do Bling e reconecte a empresa' : (err instanceof Error ? err.message : String(err)) })
      }
      await pausa(PAUSA_ENTRE_PAGINAS_MS)
    }
    return resultado
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
