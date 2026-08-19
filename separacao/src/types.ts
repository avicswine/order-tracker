// Tipos compartilhados do app de separação (espelham as respostas de /api/separacao)

export interface Operador {
  id: string
  nome: string
  supervisor: boolean
  ativo: boolean
  createdAt?: string
}

export interface Empresa {
  key: string       // avic | agrogranja | equipage
  name: string
  code: string      // AVIC | AGRO | EQUI
  connected: boolean
}

export type StatusTarefa =
  | 'AGUARDANDO_TRIAGEM' | 'PENDENTE' | 'IGNORADA' | 'EM_SEPARACAO' | 'SEPARADO' | 'CONCLUIDO' | 'CANCELADA'

export interface Progresso {
  total: number
  concluidos: number
  unidadesEsperadas: number
  unidadesBipadas: number
  completo: boolean
}

export interface OperadorRef { id: string; nome: string }

export interface TarefaResumo {
  id: string
  companyKey: string
  empresa?: { name: string; code: string }
  blingNfId: string
  nfNumero: string
  nfSerie: string | null
  chaveAcesso: string | null
  nfEmitidaEm: string | null
  clienteNome: string
  canal: string | null
  valorNota: number | null
  status: StatusTarefa
  itensCarregados: boolean
  observacao: string | null
  operador: OperadorRef | null
  triadoPor: OperadorRef | null
  finalizadoPor: OperadorRef | null
  iniciadoEm: string | null
  separadoEm: string | null
  concluidoEm: string | null
  pesoConferido: boolean
  progresso: Progresso
  createdAt: string
}

export interface Item {
  id: string
  ordem: number
  sku: string
  nome: string
  fotoUrl: string | null
  origemKit: string | null
  qtdEsperada: number
  qtdBipada: number
  qtdManual: boolean
  pesoUnit: number | null
  pesoLido: number | null
  pesoOk: boolean | null
  concluidoEm: string | null
}

export interface Evento {
  id: string
  tipo: string
  sku: string | null
  qtd: number | null
  detalhe: string | null
  criadoEm: string
  operador: { nome: string } | null
}

export interface Tarefa extends TarefaResumo {
  itens: Item[]
  eventos: Evento[]
}

export interface ResultadoBipe {
  ok: boolean
  motivo?: 'ITEM_NAO_PERTENCE' | 'ITEM_COMPLETO' | 'QTD_DIVERGENTE' | 'QTD_MANUAL_NAO_PERMITIDA' | 'BIPE_ANTES_DA_QTD' | 'ITEM_DIFERENTE_SELECIONADO' | 'CODIGO_DE_NOTA'
  mensagem: string
  item?: { id: string; sku: string; nome: string; qtdEsperada: number; qtdBipada: number; concluido: boolean }
  tarefaSeparada: boolean
  progresso: Progresso
}

export const STATUS_LABEL: Record<StatusTarefa, string> = {
  AGUARDANDO_TRIAGEM: 'Aguardando triagem',
  PENDENTE: 'Pendente',
  IGNORADA: 'Ignorada',
  EM_SEPARACAO: 'Em separação',
  SEPARADO: 'Separado',
  CONCLUIDO: 'Concluído',
  CANCELADA: 'Cancelada',
}

export interface Config {
  limiteBipeUnitario: number
  intervaloSyncMin: number
  diasNfsFila: number
  toleranciaPesoPct: number
  balancaAtiva: boolean
  nomesCanais: Record<string, string>
}

export interface Diagnostico {
  mock: boolean
  empresas: Array<{
    empresa: string
    key: string
    recursos: Array<{ recurso: 'nfe' | 'produtos' | 'canais-venda'; ok: boolean; status?: number; detalhe?: string }>
  }>
}
