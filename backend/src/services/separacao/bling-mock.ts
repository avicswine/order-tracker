import type { BlingSeparacaoAdapter, CatalogoItem, NfItemBruto, NfResumo, ProdutoResumo } from './bling-tipos'

// Dados de exemplo para desenvolver sem bater no Bling (SEPARACAO_MOCK=1).
// Cenários cobertos: item simples, kit com componentes, kit aninhado, SKU repetido
// em kits diferentes, quantidade alta (acima do limite de bipe), NF cancelada.

const PRODUTOS: ProdutoResumo[] = [
  { id: '1001', sku: 'PAR-M6', nome: 'Parafuso M6 x 20mm', pesoUnit: 0.004, componentes: [] },
  { id: '1002', sku: 'POR-M6', nome: 'Porca sextavada M6', pesoUnit: 0.002, componentes: [] },
  { id: '1003', sku: 'ARR-M6', nome: 'Arruela lisa M6', pesoUnit: 0.001, componentes: [] },
  { id: '1004', sku: 'HEL-40', nome: 'Hélice 40cm 3 pás', pesoUnit: 0.85, componentes: [] },
  { id: '1005', sku: 'MOT-1CV', nome: 'Motor 1CV monofásico', pesoUnit: 9.2, componentes: [] },
  { id: '1006', sku: 'GRA-40', nome: 'Grade de proteção 40cm', pesoUnit: 1.1, componentes: [] },
  { id: '1007', sku: 'CAB-3M', nome: 'Cabo elétrico 3m', pesoUnit: 0.3, componentes: [] },
  { id: '1008', sku: 'FIX-M6', nome: 'Kit fixação M6 (10 conj.)', componentes: [
    { produtoId: '1001', quantidade: 10 }, { produtoId: '1002', quantidade: 10 }, { produtoId: '1003', quantidade: 20 },
  ] },
  { id: '1009', sku: 'VENT-40', nome: 'Ventilador axial 40cm 1CV', fotoUrl: 'https://placehold.co/300x300?text=VENT-40', componentes: [
    { produtoId: '1004', quantidade: 1 }, { produtoId: '1005', quantidade: 1 }, { produtoId: '1006', quantidade: 2 },
    { produtoId: '1008', quantidade: 1 }, { produtoId: '1007', quantidade: 1 },
  ] },
  { id: '1010', sku: 'BEB-PLAST', nome: 'Bebedouro plástico 5L', pesoUnit: 0.6, componentes: [] },
]

const HOJE = new Date()
const ontem = new Date(HOJE); ontem.setDate(ontem.getDate() - 1)

const NFS: Record<string, { resumo: NfResumo; itens: NfItemBruto[] }[]> = {
  avic: [
    { resumo: { blingNfId: '900001', numero: '9101', serie: '1', chaveAcesso: '35260847715256000149550010000091011000091019', emitidaEm: HOJE, clienteNome: 'Granja São João', valorNota: 1890.5, canal: 'Site', cancelada: false },
      itens: [{ sku: 'VENT-40', descricao: 'Ventilador axial 40cm 1CV', quantidade: 2 }, { sku: 'CAB-3M', descricao: 'Cabo elétrico 3m', quantidade: 1 }] },
    { resumo: { blingNfId: '900002', numero: '9102', serie: '1', chaveAcesso: '35260847715256000149550010000091021000091025', emitidaEm: HOJE, clienteNome: 'Maria Silva', valorNota: 120, canal: 'Mercado Livre', cancelada: false },
      itens: [{ sku: 'FIX-M6', descricao: 'Kit fixação M6', quantidade: 3 }] },
    { resumo: { blingNfId: '900003', numero: '9103', serie: '1', emitidaEm: HOJE, clienteNome: 'Cliente Balcão', valorNota: 55, canal: 'Balcão', cancelada: false },
      itens: [{ sku: 'HEL-40', descricao: 'Hélice 40cm', quantidade: 1 }, { sku: 'HEL-40.3', descricao: 'Hélice 40cm (kit c/ 3)', quantidade: 2 }] },
    { resumo: { blingNfId: '900004', numero: '9104', serie: '1', emitidaEm: ontem, clienteNome: 'Pedido Cancelado LTDA', valorNota: 10, cancelada: true },
      itens: [{ sku: 'ARR-M6', descricao: 'Arruela', quantidade: 100 }] },
  ],
  agrogranja: [
    { resumo: { blingNfId: '910001', numero: '3301', serie: '1', emitidaEm: HOJE, clienteNome: 'Fazenda Boa Vista', valorNota: 640, canal: 'Site', cancelada: false },
      itens: [{ sku: 'BEB-PLAST', descricao: 'Bebedouro 5L', quantidade: 12 }, { sku: 'PAR-M6', descricao: 'Parafuso M6', quantidade: 50 }] },
  ],
  equipage: [],
}

const atraso = (ms = 150) => new Promise(r => setTimeout(r, ms))

export const blingMock: BlingSeparacaoAdapter = {
  async listarNfs(companyKey) {
    await atraso()
    return (NFS[companyKey] ?? []).map(n => n.resumo)
  },
  async buscarNfPorNumero(companyKey, numero) {
    await atraso()
    const n = String(parseInt(numero, 10))
    return (NFS[companyKey] ?? []).filter(x => x.resumo.numero === n).map(x => x.resumo)
  },
  async obterDetalheNf(companyKey, blingNfId) {
    await atraso()
    const nf = (NFS[companyKey] ?? []).find(n => n.resumo.blingNfId === blingNfId)
    if (!nf) throw new Error(`NF ${blingNfId} não encontrada (mock)`)
    return { serie: nf.resumo.serie, valorNota: nf.resumo.valorNota, chaveAcesso: nf.resumo.chaveAcesso, itens: nf.itens }
  },
  async diagnosticar() {
    await atraso(50)
    return [
      { recurso: 'nfe', ok: true },
      { recurso: 'produtos', ok: true },
      { recurso: 'canais-venda', ok: true },
    ]
  },
  async obterProdutoPorSku(_companyKey, sku) {
    await atraso(50)
    return PRODUTOS.find(p => p.sku.toLowerCase() === sku.trim().toLowerCase()) ?? null
  },
  async obterProdutoPorId(_companyKey, id) {
    await atraso(50)
    return PRODUTOS.find(p => p.id === id) ?? null
  },
  async listarCatalogo() {
    await atraso()
    return PRODUTOS.map((p): CatalogoItem => ({ id: p.id, sku: p.sku, nome: p.nome }))
  },
}
