import { Router, Request, Response } from 'express'
import { requireSupervisor } from '../../middleware/requireOperador'
import { bling } from '../../services/separacao/bling'
import type { CatalogoItem } from '../../services/separacao/bling-tipos'
import {
  contarImpressas, desmarcarImpressas, limparRegistroImpressas,
  listarSkusDaTarefa, listarSkusDeTarefas, listarSkusDoPeriodo, marcarImpressas,
} from '../../services/separacao/etiquetas'
import { garantirItensCarregados, precarregarItens } from '../../services/separacao/tarefas'

// Catálogo de produtos (para imprimir etiquetas QR) — /api/separacao/catalogo, supervisor.
// Listar o catálogo inteiro custa várias páginas na API do Bling → cache em memória por empresa.
const router = Router()
router.use(requireSupervisor)

const CACHE_MS = 10 * 60 * 1000
const cache = new Map<string, { em: number; itens: CatalogoItem[] }>()
const carregando = new Map<string, Promise<CatalogoItem[]>>()

async function obterCatalogo(companyKey: string, forcar: boolean): Promise<CatalogoItem[]> {
  const c = cache.get(companyKey)
  if (!forcar && c && Date.now() - c.em < CACHE_MS) return c.itens
  const emAndamento = carregando.get(companyKey)
  if (emAndamento) return emAndamento

  const p = bling.listarCatalogo(companyKey)
    .then(itens => { cache.set(companyKey, { em: Date.now(), itens }); return itens })
    .finally(() => carregando.delete(companyKey))
  carregando.set(companyKey, p)
  return p
}

// GET /catalogo/pendentes?empresa=avic&dias=1&todos=1 — SKUs físicos das NFs do período (sem etiqueta impressa, salvo todos=1)
router.get('/pendentes', async (req: Request, res: Response) => {
  const empresa = typeof req.query.empresa === 'string' ? req.query.empresa : ''
  if (!empresa) return res.status(400).json({ error: 'Informe a empresa' })
  const dias = Math.min(Math.max(Number(req.query.dias) || 1, 1), 30)
  const precarga = await precarregarItens(dias).catch(() => ({ carregadas: 0, erros: 0 })) // garante que NFs recém-chegadas entrem
  const itens = await listarSkusDoPeriodo(empresa, dias, req.query.todos === '1')
  res.json({ itens, dias, precarga })
})

// GET /catalogo/nf/:tarefaId — SKUs físicos de uma NF (carrega os itens se ainda não estiverem)
router.get('/nf/:tarefaId', async (req: Request, res: Response) => {
  try {
    await garantirItensCarregados(req.params.tarefaId)
    res.json(await listarSkusDaTarefa(req.params.tarefaId))
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'NF não encontrada' })
  }
})

const MAX_NFS_POR_LOTE = 60

// POST /catalogo/nfs { ids: [] } — SKUs de várias NFs de uma vez (imprimir etiquetas do lote da triagem)
router.post('/nfs', async (req: Request, res: Response) => {
  const { ids } = req.body ?? {}
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every(i => typeof i === 'string')) {
    return res.status(400).json({ error: 'Informe as NFs' })
  }
  const alvo = ids.slice(0, MAX_NFS_POR_LOTE)
  // Carrega do Bling o que ainda não tiver itens (NFs recém-chegadas); segue mesmo se alguma falhar
  const falhas: string[] = []
  for (const id of alvo) {
    try {
      await garantirItensCarregados(id)
    } catch (err) {
      falhas.push(id)
      console.warn('[Separação] Não foi possível carregar itens da tarefa', id, err instanceof Error ? err.message : err)
    }
  }
  const dados = await listarSkusDeTarefas(alvo)
  res.json({ ...dados, ignoradas: ids.length - alvo.length, falhas: falhas.length })
})

// POST /catalogo/pendentes/marcar { empresa, skus: [] } — registra como impressas
router.post('/pendentes/marcar', async (req: Request, res: Response) => {
  const { empresa, skus } = req.body ?? {}
  if (typeof empresa !== 'string' || !Array.isArray(skus) || !skus.every(s => typeof s === 'string')) {
    return res.status(400).json({ error: 'Informe empresa e skus' })
  }
  res.json({ marcadas: await marcarImpressas(empresa, skus, req.operador!.id) })
})

// POST /catalogo/pendentes/desmarcar { empresa, skus: [] } — volta a aparecer como pendente (reimprimir)
router.post('/pendentes/desmarcar', async (req: Request, res: Response) => {
  const { empresa, skus } = req.body ?? {}
  if (typeof empresa !== 'string' || !Array.isArray(skus) || !skus.every(s => typeof s === 'string')) {
    return res.status(400).json({ error: 'Informe empresa e skus' })
  }
  res.json({ desmarcadas: await desmarcarImpressas(empresa, skus) })
})

// GET /catalogo/impressas — quantas etiquetas estão registradas como impressas, por empresa
router.get('/impressas', async (_req: Request, res: Response) => {
  res.json(await contarImpressas())
})

// DELETE /catalogo/impressas?empresa=avic — zera o registro (recomeço da etiquetagem depois dos testes)
router.delete('/impressas', async (req: Request, res: Response) => {
  const empresa = typeof req.query.empresa === 'string' && req.query.empresa ? req.query.empresa : undefined
  res.json({ removidas: await limparRegistroImpressas(empresa) })
})

// GET /catalogo?empresa=avic&busca=texto&forcar=1
router.get('/', async (req: Request, res: Response) => {
  const empresa = typeof req.query.empresa === 'string' ? req.query.empresa : ''
  if (!empresa) return res.status(400).json({ error: 'Informe a empresa' })
  const busca = typeof req.query.busca === 'string' ? req.query.busca.trim().toLowerCase() : ''
  try {
    const itens = await obterCatalogo(empresa, req.query.forcar === '1')
    const filtrados = busca ? itens.filter(i => `${i.sku} ${i.nome}`.toLowerCase().includes(busca)) : itens
    res.json({ total: itens.length, itens: filtrados, atualizadoEm: cache.get(empresa)?.em ?? null })
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : 'Erro ao consultar o Bling' })
  }
})

export default router
