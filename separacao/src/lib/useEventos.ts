import { useEffect, useRef } from 'react'
import { urlComToken } from './api'

export interface EventoServidor {
  tipo: 'tarefas' | 'tarefa'
  tarefaId?: string
  motivo: string
}

// Assina o SSE de /tarefas/stream e chama onEvento a cada mudança.
// Reconecta sozinho (EventSource faz isso). Se cair de vez, o polling de fallback cobre.
export function useEventos(onEvento: (e: EventoServidor) => void, pollingMs = 30000) {
  const cb = useRef(onEvento)
  cb.current = onEvento

  useEffect(() => {
    const es = new EventSource(urlComToken('/tarefas/stream'))
    const handler = (ev: MessageEvent) => {
      try { cb.current(JSON.parse(ev.data)) } catch { /* ignora */ }
    }
    es.addEventListener('tarefas', handler)
    es.addEventListener('tarefa', handler)

    const poll = setInterval(() => cb.current({ tipo: 'tarefas', motivo: 'polling' }), pollingMs)
    return () => {
      es.close()
      clearInterval(poll)
    }
  }, [pollingMs])
}
