/**
 * Monitor de DIFAL: lista as notas com o imposto calculado, confronta com o que
 * o Mercado Livre cobrou e mostra o que falta recolher.
 *
 * Todas as rotas são de leitura, menos a importação, que só busca do Bling e
 * grava na nossa tabela — nada é enviado para fora.
 */
import { Router, Request, Response } from 'express'
import { query, body, validationResult } from 'express-validator'
import { prisma } from '../lib/prisma'
import { DifalResponsavel, DifalSituacao, Prisma } from '@prisma/client'
import { importarNotas } from '../services/difal/importar'
import { semearAliquotas } from '../services/difal/aliquotas'

const router = Router()

// GET /difal — lista as notas do monitor
router.get(
  '/',
  [
    query('responsavel').optional().isIn(Object.values(DifalResponsavel)),
    query('situacao').optional().isIn(Object.values(DifalSituacao)),
    query('empresa').optional().trim(),
    query('uf').optional().trim().isLength({ min: 2, max: 2 }),
    query('desde').optional().isISO8601(),
    query('ate').optional().isISO8601(),
    query('busca').optional().trim(),
    query('pagina').optional().isInt({ min: 1 }),
  ],
  async (req: Request, res: Response) => {
    const erros = validationResult(req)
    if (!erros.isEmpty()) return res.status(400).json({ errors: erros.array() })

    const { responsavel, situacao, empresa, uf, desde, ate, busca } = req.query
    const pagina = Number(req.query.pagina ?? 1)
    const porPagina = 100

    const where: Prisma.DifalNotaWhereInput = {}
    if (responsavel) where.responsavel = responsavel as DifalResponsavel
    if (situacao) where.situacao = situacao as DifalSituacao
    if (empresa) where.empresa = String(empresa).toUpperCase()
    if (uf) where.clienteUf = String(uf).toUpperCase()
    if (desde || ate) {
      where.emitidaEm = {}
      if (desde) where.emitidaEm.gte = new Date(String(desde))
      if (ate) where.emitidaEm.lte = new Date(String(ate))
    }
    if (busca) {
      const t = String(busca)
      where.OR = [
        { nfNumero: { contains: t } },
        { clienteNome: { contains: t, mode: 'insensitive' } },
      ]
    }

    const [notas, total] = await Promise.all([
      prisma.difalNota.findMany({
        where,
        orderBy: { emitidaEm: 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
      prisma.difalNota.count({ where }),
    ])

    res.json({ notas, total, pagina, porPagina })
  }
)

// GET /difal/resumo — os números do topo da tela
router.get('/resumo', async (req: Request, res: Response) => {
  const where: Prisma.DifalNotaWhereInput = {}
  if (req.query.desde) where.emitidaEm = { gte: new Date(String(req.query.desde)) }

  const porResponsavel = await prisma.difalNota.groupBy({
    by: ['responsavel'],
    where,
    _count: { _all: true },
    _sum: { difalCalculado: true, difalCobradoMl: true, difalPagoGuia: true },
  })

  const aPagar = await prisma.difalNota.aggregate({
    where: { ...where, responsavel: 'NOSSO', situacao: { in: ['PENDENTE', 'ATRASADO'] } },
    _count: { _all: true },
    _sum: { difalCalculado: true },
  })

  const divergentes = await prisma.difalNota.aggregate({
    where: { ...where, situacao: 'DIVERGENTE' },
    _count: { _all: true },
    _sum: { divergencia: true },
  })

  res.json({
    porResponsavel: porResponsavel.map((r) => ({
      responsavel: r.responsavel,
      notas: r._count._all,
      calculado: r._sum.difalCalculado ?? 0,
      cobradoMl: r._sum.difalCobradoMl ?? 0,
      pagoGuia: r._sum.difalPagoGuia ?? 0,
    })),
    aPagar: { notas: aPagar._count._all, valor: aPagar._sum.difalCalculado ?? 0 },
    divergentes: { notas: divergentes._count._all, valor: divergentes._sum.divergencia ?? 0 },
  })
})

// GET /difal/aliquotas — a tabela que a contabilidade pode ajustar
router.get('/aliquotas', async (_req: Request, res: Response) => {
  const lista = await prisma.difalAliquota.findMany({ orderBy: { uf: 'asc' } })
  res.json(lista)
})

// PUT /difal/aliquotas/:uf — corrigir a alíquota de um estado
router.put(
  '/aliquotas/:uf',
  [
    body('aliquotaInterna').optional().isFloat({ min: 0, max: 40 }),
    body('fcp').optional().isFloat({ min: 0, max: 10 }),
    body('interestadual').optional().isFloat({ min: 0, max: 20 }),
    body('metodo').optional().isIn(['carga', 'prop']),
    body('nota').optional().trim(),
  ],
  async (req: Request, res: Response) => {
    const erros = validationResult(req)
    if (!erros.isEmpty()) return res.status(400).json({ errors: erros.array() })

    const uf = String(req.params.uf).toUpperCase()
    const { aliquotaInterna, fcp, interestadual, metodo, nota } = req.body
    const atualizada = await prisma.difalAliquota.update({
      where: { uf },
      data: {
        ...(aliquotaInterna !== undefined && { aliquotaInterna: Number(aliquotaInterna) }),
        ...(fcp !== undefined && { fcp: Number(fcp) }),
        ...(interestadual !== undefined && { interestadual: Number(interestadual) }),
        ...(metodo !== undefined && { metodo: String(metodo) }),
        ...(nota !== undefined && { nota: String(nota) }),
      },
    })
    res.json(atualizada)
  }
)

// POST /difal/importar — busca as notas do Bling e calcula (só leitura no Bling)
router.post(
  '/importar',
  [body('dias').optional().isInt({ min: 1, max: 365 }), body('empresa').optional().trim()],
  async (req: Request, res: Response) => {
    const dias = Number(req.body?.dias ?? 90)
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000)
    try {
      await semearAliquotas(prisma)
      const resultado = await importarNotas(prisma, {
        desde,
        empresa: req.body?.empresa ? String(req.body.empresa) : undefined,
      })
      res.json({ ok: true, desde, resultado })
    } catch (e) {
      res.status(500).json({ ok: false, erro: (e as Error).message })
    }
  }
)

export default router
