import { Router, Request, Response } from 'express'
import { requireSupervisor } from '../../middleware/requireOperador'
import { bling } from '../../services/separacao/bling'
import type { CatalogoItem } from '../../services/separacao/bling-tipos'

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
