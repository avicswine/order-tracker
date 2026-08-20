import express, { Router, Request, Response, NextFunction } from 'express'
import { SeparacaoStatus } from '@prisma/client'
import { imagemDeBase64, lerDanfeDaImagem } from '../../services/separacao/ocr-danfe'
import { requireSupervisor } from '../../middleware/requireOperador'
import * as svc from '../../services/separacao/tarefas'
import { barramento, type EventoSeparacao } from '../../services/separacao/eventos'

// /api/separacao/tarefas — já atrás de requireOperador
const router = Router()

// Converte ErroSeparacao em resposta HTTP; erros do Bling (axios) viram 502 com mensagem; o resto 500.
// Sem isso o Express devolveria o status do erro do axios (ex.: 403 "Forbidden" em HTML) para o app.
export function tratar(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response, _next: NextFunction) => {
    try {
      await fn(req, res)
    } catch (err) {
      if (err instanceof svc.ErroSeparacao) return res.status(err.status).json({ error: err.message, codigo: err.codigo })
      const status = (err as { response?: { status?: number } })?.response?.status
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Separação] ${req.method} ${req.originalUrl} →`, msg)
      if (status) {
        const dica = status === 403 ? ' (o app do Bling não tem permissão para este recurso — veja Configurações → Diagnóstico)' : ''
        return res.status(502).json({ error: `Bling respondeu ${status}${dica}`, codigo: 'BLING_ERRO', blingStatus: status })
      }
      res.status(500).json({ error: 'Erro interno', codigo: 'ERRO_INTERNO' })
    }
  }
}

function parseStatus(valor: unknown): SeparacaoStatus[] | undefined {
  if (typeof valor !== 'string' || !valor) return undefined
  const validos = new Set(Object.values(SeparacaoStatus))
  return valor.split(',').map(s => s.trim().toUpperCase()).filter((s): s is SeparacaoStatus => validos.has(s as SeparacaoStatus))
}

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/
const dataQuery = (v: unknown) => (typeof v === 'string' && REGEX_DATA.test(v) ? v : undefined)

// GET /tarefas?status=PENDENTE,EM_SEPARACAO&empresa=avic&dias=2  (ou &dataInicial=2026-08-01&dataFinal=2026-08-10)
router.get('/', tratar(async (req, res) => {
  const dias = req.query.dias ? Number(req.query.dias) : undefined
  const lista = await svc.listarTarefas({
    status: parseStatus(req.query.status),
    companyKey: typeof req.query.empresa === 'string' ? req.query.empresa : undefined,
    dias: dias && Number.isFinite(dias) ? Math.min(Math.max(dias, 1), 90) : undefined,
    dataInicial: dataQuery(req.query.dataInicial),
    dataFinal: dataQuery(req.query.dataFinal),
  })
  res.json(lista)
}))

// POST /tarefas/sync { dataInicial?, dataFinal?, empresa? } — busca NFs no Bling agora
// (sem corpo: NFs do dia, igual ao automático; com período: importa NFs antigas para a triagem)
router.post('/sync', tratar(async (req, res) => {
  const { dataInicial, dataFinal, empresa } = req.body ?? {}
  res.json(await svc.sincronizarNfs({
    dataInicial: dataQuery(dataInicial), dataFinal: dataQuery(dataFinal),
    companyKey: typeof empresa === 'string' && empresa ? empresa : undefined,
  }))
}))

// POST /tarefas/ler-danfe { imagem } — foto da etiqueta DANFE → OCR → localiza a NF
// (alternativa quando a câmera não decodifica o código de barras)
router.post('/ler-danfe', express.json({ limit: '10mb' }), tratar(async (req, res) => {
  const imagem = imagemDeBase64(typeof req.body?.imagem === 'string' ? req.body.imagem : '')
  if (!imagem) return res.status(400).json({ error: 'Envie a foto da etiqueta' })

  const leitura = await lerDanfeDaImagem(imagem)
  const codigo = leitura.chave ?? leitura.numero
  if (!codigo) {
    return res.status(422).json({
      error: 'Não consegui ler o número da nota na foto. Aproxime, evite sombra e tente de novo — ou digite o número.',
      codigo: 'OCR_SEM_LEITURA', leitura,
    })
  }
  const empresa = typeof req.body?.empresa === 'string' && req.body.empresa ? req.body.empresa : undefined
  const localizado = await svc.localizarPorCodigo(codigo, empresa)
  res.json({ ...localizado, leitura: { chave: leitura.chave, numero: leitura.numero, serie: leitura.serie } })
}))

// POST /tarefas/importar { empresa, numero } — busca uma NF pelo número no Bling e coloca na triagem
router.post('/importar', requireSupervisor, tratar(async (req, res) => {
  const { empresa, numero } = req.body ?? {}
  if (typeof empresa !== 'string' || !empresa || typeof numero !== 'string' || !numero.trim()) {
    return res.status(400).json({ error: 'Informe empresa e número da NF' })
  }
  res.json(await svc.importarNfPorNumero(empresa, numero.trim()))
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

// GET /tarefas/canais — ids de loja vistos nas NFs (para nomear canais na config)
router.get('/canais', tratar(async (_req, res) => {
  res.json(await svc.canaisVistos())
}))

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

// GET /tarefas/:id/estrutura — itens da NF já explodidos (carrega do Bling se preciso), para conferir na triagem
router.get('/:id/estrutura', tratar(async (req, res) => {
  await svc.garantirItensCarregados(req.params.id)
  const t = await svc.obterTarefa(req.params.id)
  res.json({
    nfNumero: t.nfNumero, clienteNome: t.clienteNome, canal: t.canal, valorNota: t.valorNota,
    nfEmitidaEm: t.nfEmitidaEm, empresa: t.empresa, status: t.status,
    itens: t.itens.map(i => ({ sku: i.sku, nome: i.nome, qtdEsperada: i.qtdEsperada, origemKit: i.origemKit, fotoUrl: i.fotoUrl, pesoUnit: i.pesoUnit })),
  })
}))

router.post('/:id/iniciar', tratar(async (req, res) => {
  res.json(await svc.iniciar(req.params.id, req.operador!))
}))

// POST /tarefas/:id/bipar { codigo: 'SKU', qtd?: number, itemSelecionadoId?: string }
router.post('/:id/bipar', tratar(async (req, res) => {
  const { codigo, qtd, itemSelecionadoId } = req.body ?? {}
  if (typeof codigo !== 'string' || !codigo.trim()) return res.status(400).json({ error: 'Informe o código bipado' })
  let qtdManual: number | undefined
  if (qtd !== undefined && qtd !== null) {
    qtdManual = Number(qtd)
    if (!Number.isFinite(qtdManual) || qtdManual <= 0) return res.status(400).json({ error: 'Quantidade inválida' })
  }
  const selecionado = typeof itemSelecionadoId === 'string' && itemSelecionadoId ? itemSelecionadoId : undefined
  res.json(await svc.bipar(req.params.id, req.operador!, codigo, qtdManual, selecionado))
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
