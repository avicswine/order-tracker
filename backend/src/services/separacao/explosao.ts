import type { BlingSeparacaoAdapter, NfItemBruto, ProdutoResumo } from './bling-tipos'

// Explode os itens de uma NF até os itens FÍSICOS (kits em N níveis) e agrupa por SKU.
// Um SKU que aparece em kits diferentes vira UMA linha (soma das quantidades) — para o
// bipe é o que importa; a rastreabilidade das origens fica no campo origemKit.

export interface ItemFisico {
  sku: string
  nome: string
  fotoUrl?: string
  blingProdutoId?: string
  pesoUnit?: number
  qtd: number
  origens: string[]      // ex.: ["VENT-40 ×2", "FIX-M6 ×3"]; vazio = veio direto na NF
}

const PROFUNDIDADE_MAX = 10

// SKU "virtual" no padrão BASE.N (ex.: SEN001.5 = 5 × SEN001). Na prateleira só existe o QR do SEN001.
// Só vale quando o produto NÃO tem composição cadastrada e o SKU base existe no Bling.
const REGEX_SKU_VIRTUAL = /^(.+?)\.(\d{1,4})$/

export function interpretarSkuVirtual(sku: string): { base: string; multiplo: number } | null {
  const m = sku.trim().match(REGEX_SKU_VIRTUAL)
  if (!m) return null
  const multiplo = parseInt(m[2], 10)
  if (!Number.isFinite(multiplo) || multiplo < 1) return null
  return { base: m[1], multiplo }
}

interface Cache {
  porSku: Map<string, ProdutoResumo | null>
  porId: Map<string, ProdutoResumo | null>
}

async function produtoPorSku(adapter: BlingSeparacaoAdapter, companyKey: string, sku: string, cache: Cache) {
  const chave = sku.trim().toLowerCase()
  if (!cache.porSku.has(chave)) {
    const p = await adapter.obterProdutoPorSku(companyKey, sku)
    cache.porSku.set(chave, p)
    if (p) cache.porId.set(p.id, p)
  }
  return cache.porSku.get(chave) ?? null
}

async function produtoPorId(adapter: BlingSeparacaoAdapter, companyKey: string, id: string, cache: Cache) {
  if (!cache.porId.has(id)) {
    const p = await adapter.obterProdutoPorId(companyKey, id)
    cache.porId.set(id, p)
    if (p) cache.porSku.set(p.sku.trim().toLowerCase(), p)
  }
  return cache.porId.get(id) ?? null
}

function formatarQtd(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/\.?0+$/, '')
}

async function explodirProduto(
  adapter: BlingSeparacaoAdapter,
  companyKey: string,
  produto: ProdutoResumo,
  qtd: number,
  origem: string[],
  cache: Cache,
  saida: ItemFisico[],
  profundidade: number,
  visitados: Set<string>,
) {
  const eKit = produto.componentes.length > 0
  if (!eKit || profundidade >= PROFUNDIDADE_MAX || visitados.has(produto.id)) {
    // Sem composição: pode ser SKU virtual BASE.N → N × BASE (se BASE existir no cadastro)
    const virtual = !eKit && profundidade < PROFUNDIDADE_MAX ? interpretarSkuVirtual(produto.sku) : null
    if (virtual) {
      const base = await produtoPorSku(adapter, companyKey, virtual.base, cache)
      if (base && base.id !== produto.id) {
        const novaOrigem = [...origem, `${produto.sku} ×${formatarQtd(qtd)}`]
        const novosVisitados = new Set(visitados).add(produto.id)
        await explodirProduto(adapter, companyKey, base, virtual.multiplo * qtd, novaOrigem, cache, saida, profundidade + 1, novosVisitados)
        return
      }
    }
    saida.push({
      sku: produto.sku, nome: produto.nome, fotoUrl: produto.fotoUrl,
      blingProdutoId: produto.id, pesoUnit: produto.pesoUnit, qtd, origens: [...origem],
    })
    return
  }

  const novaOrigem = [...origem, `${produto.sku} ×${formatarQtd(qtd)}`]
  const novosVisitados = new Set(visitados).add(produto.id)
  for (const comp of produto.componentes) {
    const filho = await produtoPorId(adapter, companyKey, comp.produtoId, cache)
    if (!filho) {
      saida.push({ sku: `ID-${comp.produtoId}`, nome: 'Componente não encontrado no Bling', qtd: comp.quantidade * qtd, origens: novaOrigem })
      continue
    }
    await explodirProduto(adapter, companyKey, filho, comp.quantidade * qtd, novaOrigem, cache, saida, profundidade + 1, novosVisitados)
  }
}

export async function explodirItensNf(adapter: BlingSeparacaoAdapter, companyKey: string, itensNf: NfItemBruto[]): Promise<ItemFisico[]> {
  const cache: Cache = { porSku: new Map(), porId: new Map() }
  const brutos: ItemFisico[] = []

  for (const item of itensNf) {
    if (!item.sku) {
      brutos.push({ sku: 'SEM-SKU', nome: item.descricao || 'Item sem código', qtd: item.quantidade, origens: [] })
      continue
    }
    const produto = await produtoPorSku(adapter, companyKey, item.sku, cache)
    if (!produto) {
      // SKU virtual BASE.N que nem existe no cadastro → tenta o BASE direto
      const virtual = interpretarSkuVirtual(item.sku)
      const base = virtual ? await produtoPorSku(adapter, companyKey, virtual.base, cache) : null
      if (virtual && base) {
        await explodirProduto(adapter, companyKey, base, virtual.multiplo * item.quantidade, [`${item.sku} ×${formatarQtd(item.quantidade)}`], cache, brutos, 1, new Set())
        continue
      }
      // Não achou no cadastro → trata como item físico com os dados da própria NF
      const pesoUnit = item.pesoBruto || item.pesoLiquido
      brutos.push({ sku: item.sku, nome: item.descricao, qtd: item.quantidade, pesoUnit: pesoUnit && item.quantidade ? pesoUnit / item.quantidade : undefined, origens: [] })
      continue
    }
    await explodirProduto(adapter, companyKey, produto, item.quantidade, [], cache, brutos, 0, new Set())
  }

  // Agrupa por SKU
  const porSku = new Map<string, ItemFisico>()
  for (const b of brutos) {
    const chave = b.sku.trim().toLowerCase()
    const existente = porSku.get(chave)
    if (!existente) {
      porSku.set(chave, { ...b, origens: [...b.origens] })
      continue
    }
    existente.qtd += b.qtd
    // Mesmo SKU vindo direto na NF e também dentro de um kit → registra as duas origens
    const DIRETO = 'direto na NF'
    if (existente.origens.length === 0 && b.origens.length > 0) existente.origens.push(DIRETO)
    if (b.origens.length === 0 && existente.origens.length > 0 && !existente.origens.includes(DIRETO)) existente.origens.push(DIRETO)
    for (const o of b.origens) if (!existente.origens.includes(o)) existente.origens.push(o)
    existente.fotoUrl ||= b.fotoUrl
    existente.pesoUnit ||= b.pesoUnit
    existente.blingProdutoId ||= b.blingProdutoId
  }
  return [...porSku.values()]
}
