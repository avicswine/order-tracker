/**
 * Cores dos selos de status: um lugar só para todas as telas.
 * Cada status escolhe um TOM; o formato do selo vem da classe .selo (componentes.css).
 */
export type Tom = 'cinza' | 'primaria' | 'azul' | 'ambar' | 'ambarForte' | 'laranja' | 'verde' | 'vermelho'

export const TOM: Record<Tom, { selo: string; ponto: string; texto: string }> = {
  cinza: { selo: 'border-slate-200 bg-slate-100 text-slate-700', ponto: 'bg-slate-400', texto: 'text-slate-600' },
  primaria: { selo: 'border-primaria-200 bg-primaria-50 text-primaria-800', ponto: 'bg-primaria-600', texto: 'text-primaria-700' },
  azul: { selo: 'border-blue-200 bg-blue-50 text-blue-800', ponto: 'bg-blue-500', texto: 'text-blue-700' },
  ambar: { selo: 'border-amber-200 bg-amber-50 text-amber-800', ponto: 'bg-amber-500', texto: 'text-amber-700' },
  // âmbar mais forte: 'entregue com ocorrência' (diferente do 'faturado', que é âmbar claro)
  ambarForte: { selo: 'border-amber-300 bg-amber-100 text-amber-900', ponto: 'bg-amber-600', texto: 'text-amber-800' },
  laranja: { selo: 'border-orange-200 bg-orange-50 text-orange-800', ponto: 'bg-orange-500', texto: 'text-orange-700' },
  verde: { selo: 'border-emerald-200 bg-emerald-50 text-emerald-800', ponto: 'bg-emerald-500', texto: 'text-emerald-700' },
  vermelho: { selo: 'border-red-200 bg-red-50 text-red-800', ponto: 'bg-red-500', texto: 'text-red-700' },
}

/** classes prontas de um selo do tom pedido */
export function seloTom(tom: Tom): string {
  return `selo ${TOM[tom].selo}`
}
