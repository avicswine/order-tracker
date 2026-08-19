import { Router, Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { requireSupervisor } from '../../middleware/requireOperador'
import {
  atualizarOperador, criarOperador, nomeValido, pinValido, OPERADOR_PUBLICO,
} from '../../services/separacao/operadores'

// Gestão de operadores — só supervisores. Montado em /api/separacao/operadores (já atrás de requireOperador)
const router = Router()
router.use(requireSupervisor)

router.get('/', async (_req: Request, res: Response) => {
  const lista = await prisma.separacaoOperador.findMany({ select: OPERADOR_PUBLICO, orderBy: { nome: 'asc' } })
  res.json(lista)
})

router.post('/', async (req: Request, res: Response) => {
  const { nome, pin, supervisor } = req.body ?? {}
  if (!nomeValido(nome)) return res.status(400).json({ error: 'Nome deve ter entre 2 e 40 caracteres' })
  if (!pinValido(pin)) return res.status(400).json({ error: 'PIN deve ter de 4 a 8 dígitos' })
  try {
    const operador = await criarOperador({ nome, pin, supervisor: supervisor === true })
    res.status(201).json(operador)
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : 'Erro ao criar operador' })
  }
})

router.patch('/:id', async (req: Request, res: Response) => {
  const { nome, pin, supervisor, ativo } = req.body ?? {}
  if (nome !== undefined && !nomeValido(nome)) return res.status(400).json({ error: 'Nome inválido' })
  if (pin !== undefined && !pinValido(pin)) return res.status(400).json({ error: 'PIN deve ter de 4 a 8 dígitos' })
  if (supervisor !== undefined && typeof supervisor !== 'boolean') return res.status(400).json({ error: 'supervisor inválido' })
  if (ativo !== undefined && typeof ativo !== 'boolean') return res.status(400).json({ error: 'ativo inválido' })

  // Um supervisor não pode se rebaixar/desativar — evita ficar sem ninguém para gerir
  if (req.params.id === req.operador!.id && (supervisor === false || ativo === false)) {
    return res.status(400).json({ error: 'Você não pode remover seu próprio acesso de supervisor' })
  }

  try {
    const operador = await atualizarOperador(req.params.id, { nome, pin, supervisor, ativo })
    res.json(operador)
  } catch {
    res.status(404).json({ error: 'Operador não encontrado' })
  }
})

export default router
