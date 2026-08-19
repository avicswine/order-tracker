import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { prisma } from '../../lib/prisma'
import { requireOperador } from '../../middleware/requireOperador'
import {
  autenticarOperador, criarOperador, nomeValido, pinValido, totalOperadores, OPERADOR_PUBLICO,
} from '../../services/separacao/operadores'

// Rotas públicas de autenticação do módulo de separação: /api/separacao/auth/*
const router = Router()

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // vários operadores atrás do mesmo IP do galpão
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos.' },
})

// GET /auth/setup-status — o app pergunta se ainda não existe nenhum operador (primeiro uso)
router.get('/setup-status', async (_req: Request, res: Response) => {
  res.json({ precisaSetup: (await totalOperadores()) === 0 })
})

// POST /auth/setup — cria o PRIMEIRO supervisor. Só funciona enquanto não existir nenhum operador.
router.post('/setup', loginLimiter, async (req: Request, res: Response) => {
  if ((await totalOperadores()) > 0) {
    return res.status(409).json({ error: 'Setup já foi feito. Peça a um supervisor para criar seu acesso.' })
  }
  const { nome, pin } = req.body ?? {}
  if (!nomeValido(nome)) return res.status(400).json({ error: 'Nome deve ter entre 2 e 40 caracteres' })
  if (!pinValido(pin)) return res.status(400).json({ error: 'PIN deve ter de 4 a 8 dígitos' })

  const operador = await criarOperador({ nome, pin, supervisor: true })
  const auth = await autenticarOperador(nome, pin)
  res.status(201).json({ operador, token: auth?.token })
})

// POST /auth/login — nome + PIN
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { nome, pin } = req.body ?? {}
  if (!nomeValido(nome) || !pinValido(pin)) {
    return res.status(400).json({ error: 'Informe nome e PIN (4 a 8 dígitos)' })
  }
  const auth = await autenticarOperador(nome, pin)
  if (!auth) return res.status(401).json({ error: 'Nome ou PIN inválidos' })
  res.json(auth)
})

// GET /auth/me
router.get('/me', requireOperador, async (req: Request, res: Response) => {
  const operador = await prisma.separacaoOperador.findUnique({ where: { id: req.operador!.id }, select: OPERADOR_PUBLICO })
  if (!operador || !operador.ativo) return res.status(401).json({ error: 'Operador inativo' })
  res.json(operador)
})

// GET /auth/operadores-ativos — nomes para o seletor da tela de login (sem dados sensíveis)
router.get('/operadores-ativos', async (_req: Request, res: Response) => {
  const lista = await prisma.separacaoOperador.findMany({
    where: { ativo: true }, select: { nome: true }, orderBy: { nome: 'asc' },
  })
  res.json(lista.map(o => o.nome))
})

export default router
