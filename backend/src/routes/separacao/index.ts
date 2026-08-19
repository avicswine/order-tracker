import { Router, Request, Response } from 'express'
import authRouter from './auth'
import operadoresRouter from './operadores'
import tarefasRouter from './tarefas'
import catalogoRouter from './catalogo'
import { requireOperador, requireSupervisor } from '../../middleware/requireOperador'
import { listarEmpresasBling } from '../bling'
import { getConfig, setConfig, validarConfig } from '../../services/separacao/config'

// Módulo de Separação por bipe — montado em /api/separacao (ver PLANO-SEPARACAO.md)
// Tudo aqui é isolado do painel: auth própria (operador + PIN), tabelas separacao_*.
const router = Router()

// Público (login, setup inicial)
router.use('/auth', authRouter)

// Daqui para baixo exige operador logado
router.use(requireOperador)

router.get('/empresas', (_req: Request, res: Response) => {
  res.json(listarEmpresasBling())
})

router.get('/config', async (_req: Request, res: Response) => {
  res.json(await getConfig())
})

router.put('/config', requireSupervisor, async (req: Request, res: Response) => {
  const validacao = validarConfig(req.body)
  if (!validacao.ok) return res.status(400).json({ error: validacao.erro })
  res.json(await setConfig(validacao.valores))
})

router.use('/operadores', operadoresRouter)
router.use('/tarefas', tarefasRouter)
router.use('/catalogo', catalogoRouter)

export default router
