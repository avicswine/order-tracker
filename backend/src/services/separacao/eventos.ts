import { EventEmitter } from 'events'

// Barramento em memória para avisar telas abertas (SSE) que algo mudou.
// Suficiente para 1 instância (Railway); se um dia houver várias, trocar por pub/sub.
export type EventoSeparacao =
  | { tipo: 'tarefas'; motivo: string }                       // fila mudou (sync, triagem, status)
  | { tipo: 'tarefa'; tarefaId: string; motivo: string }      // uma tarefa específica mudou (bipe, itens)

class BarramentoSeparacao extends EventEmitter {}
export const barramento = new BarramentoSeparacao()
barramento.setMaxListeners(100)

export function emitir(evento: EventoSeparacao) {
  barramento.emit('evento', evento)
}
