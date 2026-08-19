import { Router, Request, Response, NextFunction } from 'express'
import { SeparacaoStatus } from '@prisma/client'
import { requireSupervisor } from '../../middleware/requireOperador'
import * as svc from '../../services/separacao/tarefas'
import { barramento, type EventoSeparacao } from '../../services/separacao/eventos'

// /api/separacao/tarefas — já atrás de requireOperador
const router = Router()

// Converte ErroSeparacao em resposta HTTP; o resto vira 500
function tratar(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res)
    } catch (err) {
      if (err instanceof svc.ErroSeparacao) return res.status(err.status).json({ error: err.message, codigo: err.codigo })
      next(err)
    }
  }
}

function parseStatus(valor: unknown): SeparacaoStatus[] | undefined {
  if (typeof valor !== 'string' || !valor) return undefined
  const validos = new Set(Object.values(SeparacaoStatus))
  return valor.split(',').map(s => s.trim().toUpperCase()).filter((s): s is SeparacaoStatus => validos.has(s as SeparacaoStatus))
}

// GET /tarefas?status=PENDENTE,EM_SEPARACAO&empresa=avic&dias=2
router.get('/', tratar(async (req, res) => {
  const dias = req.query.dias ? Number(req.query.dias) : undefined
  const lista = await svc.listarTarefas({
    status: parseStatus(req.query.status),
    companyKey: typeof req.query.empresa === 'string' ? req.query.empresa : undefined,
    dias: dias && Number.isFinite(dias) ? Math.min(Math.max(dias, 1), 90) : undefined,
  })
  res.json(lista)
}))

// POST /tarefas/sync — busca NFs novas no Bling agora (também roda sozinho no intervalo configurado)
router.post('/sync', tratar(async (_req, res) => {
  res.json(await svc.sincronizarNfs())
}))

// GET /tarefas/stream — SSE: avisa quando a fila ou uma tarefa muda (front refaz o GET)
router.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  res.write(`event: conectado\ndata: {}\n\n`)

  const ouvinte = (evento: EventoSeparacao) => {
    res.write(`event: ${evento.tipo}\ndata: ${JSON.stringify(evento)}\n\n`)
  }
  barramento.on('evento', ouvinte)
  const ping = setInterval(() => res.write(': ping\n\n'), 25000)

  req.on('close', () => {
    clearInterval(ping)
    barramento.off('evento', ouvinte)
  })
})

// GET /tarefas/localizar?codigo=<chave 44 dígitos | número NF>&empresa=avic
router.get('/localizar', tratar(async (req, res) => {
  const codigo = typeof req.query.codigo === 'string' ? req.query.codigo : ''
  const empresa = typeof req.query.empresa === 'string' ? req.query.empresa : undefined
  res.json(await svc.localizarPorCodigo(codigo, empresa))
}))

// POST /tarefas/triagem { ids: [], acao: 'separar' | 'ignorar' | 'voltar' }
router.post('/triagem', requireSupervisor, tratar(async (req, res) => {
  const { ids, acao } = req.body ?? {}
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(i => typeof i === 'string')) {
    return res.status(400).json({ error: 'Informe ids' })
  }
  const alteradas = await svc.triar(ids, acao, req.operador!)
  res.json({ alteradas })
}))

router.get('/:id', tratar(async (req, res) => {
  res.json(await svc.obterTarefa(req.params.id))
}))

router.post('/:id/iniciar', tratar(async (req, res) => {
  res.json(await svc.iniciar(req.params.id, req.operador!))
}))

// POST /tarefas/:id/bipar { codigo: 'SKU', qtd?: number }
router.post('/:id/bipar', tratar(async (req, res) => {
  const { codigo, qtd } = req.body ?? {}
  if (typeof codigo !== 'string' || !codigo.trim()) return res.status(400).json({ error: 'Informe o código bipado' })
  let qtdManual: number | undefined
  if (qtd !== undefined && qtd !== null) {
    qtdManual = Number(qtd)
    if (!Number.isFinite(qtdManual) || qtdManual <= 0) return res.status(400).json({ error: 'Quantidade inválida' })
  }
  res.json(await svc.bipar(req.params.id, req.operador!, codigo, qtdManual))
}))

router.post('/:id/itens/:itemId/zerar', tratar(async (req, res) => {
  res.json(await svc.zerarItem(req.params.id, req.params.itemId, req.operador!))
}))

// Balcão (supervisor)
router.post('/:id/finalizar', requireSupervisor, tratar(async (req, res) => {
  const { liberar, motivo } = req.body ?? {}
  res.json(await svc.finalizar(req.params.id, req.operador!, { liberar: liberar === true, motivo: typeof motivo === 'string' ? motivo : undefined }))
}))

router.post('/:id/reabrir', requireSupervisor, tratar(async (req, res) => {
  const { motivo } = req.body ?? {}
  res.json(await svc.reabrir(req.params.id, req.operador!, typeof motivo === 'string' ? motivo : undefined))
}))

// Peso de um item (fase 4b) — { peso: number } em kg
router.post('/:id/itens/:itemId/peso', requireSupervisor, tratar(async (req, res) => {
  const peso = Number(req.body?.peso)
  res.json(await svc.registrarPesoItem(req.params.id, req.params.itemId, peso, req.operador!))
}))

export default router
