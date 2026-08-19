// Tipos internos do módulo de separação para o que vem do Bling.
// A implementação real (bling-real.ts) e a de teste (bling-mock.ts) devolvem estes tipos —
// o restante do módulo nunca vê o JSON cru do Bling.

export interface NfResumo {
  blingNfId: string
  numero: string
  serie?: string
  chaveAcesso?: string
  emitidaEm?: Date
  clienteNome: string
  valorNota?: number
  canal?: string          // nome da loja/canal, quando disponível
  cancelada: boolean
}

export interface NfItemBruto {
  sku: string
  descricao: string
  quantidade: number
  pesoBruto?: number
  pesoLiquido?: number
}

export interface ProdutoResumo {
  id: string
  sku: string
  nome: string
  fotoUrl?: string
  pesoUnit?: number       // kg (pesoBruto, senão pesoLiquido)
  componentes: { produtoId: string; quantidade: number }[]   // vazio = item simples
}

export interface CatalogoItem {
  id: string
  sku: string
  nome: string
}

export interface NfDetalhe {
  serie?: string
  valorNota?: number
  chaveAcesso?: string
  itens: NfItemBruto[]
}

export interface DiagnosticoRecurso {
  recurso: 'nfe' | 'produtos' | 'canais-venda'
  ok: boolean
  status?: number
  detalhe?: string
}

export interface BlingSeparacaoAdapter {
  // NFs de saída emitidas no período (inclusive), com paginação resolvida internamente
  listarNfs(companyKey: string, dataInicial: string, dataFinal: string): Promise<NfResumo[]>
  // NF de saída pelo número (pode haver mais de uma série)
  buscarNfPorNumero(companyKey: string, numero: string): Promise<NfResumo[]>
  obterDetalheNf(companyKey: string, blingNfId: string): Promise<NfDetalhe>
  // null = não encontrado OU sem permissão de produtos (ver produtosDisponiveis)
  obterProdutoPorSku(companyKey: string, sku: string): Promise<ProdutoResumo | null>
  obterProdutoPorId(companyKey: string, id: string): Promise<ProdutoResumo | null>
  listarCatalogo(companyKey: string): Promise<CatalogoItem[]>
  diagnosticar(companyKey: string): Promise<DiagnosticoRecurso[]>
}
