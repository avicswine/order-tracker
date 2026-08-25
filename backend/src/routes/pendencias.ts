import { Router, Request, Response } from 'express'
import { body, query, validationResult } from 'express-validator'
import { prisma } from '../lib/prisma'
import { PendenciaTipo, PendenciaStatus, PendenciaOrigem, Prisma } from '@prisma/client'
import { buscarNfNoBling, listarEmpresasBling } from './bling'

const router = Router()

// GET /pendencias?status=&tipo=&empresa=&origem=&search=
router.get(
  '/',
  [
    query('status').optional().isIn(Object.values(PendenciaStatus)),
    query('tipo').optional().isIn(Object.values(PendenciaTipo)),
    query('empresa').optional().trim(),
    query('origem').optional().isIn(Object.values(PendenciaOrigem)),
    query('search').optional().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const where: Prisma.PendenciaWhereInput = {}
    if (req.query.status) where.status = req.query.status as PendenciaStatus
    if (req.query.tipo) where.tipo = req.query.tipo as PendenciaTipo
    if (req.query.empresa) where.senderCnpj = req.query.empresa as string
    if (req.query.origem) where.origem = req.query.origem as PendenciaOrigem
    if (req.query.search) {
      const search = req.query.search as string
      where.OR = [
        { nfNumber: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
      ]
    }

    try {
      const pendencias = await prisma.pendencia.findMany({
        where,
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
          order: {
            select: {
              id: true, orderNumber: true, status: true, lastTracking: true,
              estimatedDelivery: true, carrier: { select: { name: true } },
            },
          },
          notas: { orderBy: { createdAt: 'desc' } },
        },
      })
      res.json(pendencias)
    } catch {
      res.status(500).json({ error: 'Falha ao buscar pendências' })
    }
  }
)

// GET /pendencias/lookup-nf/:nf?company=avic|agrogranja|equipage
// Busca a NF no painel (tem rastreio) e, se não achar, direto no Bling — NFs sem
// transportadora rastreável (ex: Mercado Envios) não entram no painel mas existem no Bling.
router.get('/lookup-nf/:nf', async (req: Request, res: Response) => {
  const nf = String(parseInt(req.params.nf, 10))
  if (!nf || nf === 'NaN') return res.status(400).json({ error: 'NF inválida' })
  const company = typeof req.query.company === 'string' ? req.query.company : undefined
  const companyCnpj = company ? listarEmpresasBling().find((e) => e.key === company)?.cnpj : undefined

  try {
    const orders = await prisma.order.findMany({
      where: {
        nfNumber: { in: [nf, nf.padStart(6, '0'), req.params.nf] },
        ...(companyCnpj && { senderCnpj: companyCnpj }),
      },
      select: {
        id: true, orderNumber: true, nfNumber: true, customerName: true, senderCnpj: true,
        status: true, lastTracking: true, estimatedDelivery: true, hasOccurrence: true,
        carrier: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (orders.length > 0) {
      return res.json(orders.map((o) => ({ ...o, fonte: 'painel' })))
    }

    // Não está no painel — busca direto no Bling
    const doBling = await buscarNfNoBling(nf, company)
    res.json(doBling.map((b) => ({
      id: null,
      orderNumber: `${b.companyCode}-NF-${b.numero.padStart(6, '0')}`,
      nfNumber: b.numero,
      customerName: b.customerName,
      senderCnpj: b.senderCnpj,
      status: null,
      lastTracking: null,
      estimatedDelivery: null,
      hasOccurrence: false,
      carrier: null,
      fonte: 'bling',
    })))
  } catch {
    res.status(500).json({ error: 'Falha na busca' })
  }
})

// POST /pendencias — criação manual
router.post(
  '/',
  [
    body('customerName').trim().notEmpty().withMessage('Cliente é obrigatório'),
    body('tipo').isIn(Object.values(PendenciaTipo)),
    body('nfNumber').optional({ values: 'falsy' }).trim(),
    body('orderId').optional({ values: 'falsy' }).trim(),
    body('senderCnpj').optional({ values: 'falsy' }).trim(),
    body('descricao').optional({ values: 'falsy' }).trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const pendencia = await prisma.pendencia.create({
        data: {
          orderId: req.body.orderId || null,
          nfNumber: req.body.nfNumber || null,
          customerName: req.body.customerName,
          senderCnpj: req.body.senderCnpj || null,
          tipo: req.body.tipo,
          origem: PendenciaOrigem.MANUAL,
          descricao: req.body.descricao || null,
        },
        include: { order: { select: { orderNumber: true } } },
      })
      res.status(201).json(pendencia)
    } catch {
      res.status(500).json({ error: 'Falha ao criar pendência' })
    }
  }
)

// PATCH /pendencias/:id — muda status / edita campos
router.patch(
  '/:id',
  [
    body('status').optional().isIn(Object.values(PendenciaStatus)),
    body('tipo').optional().isIn(Object.values(PendenciaTipo)),
    body('descricao').optional({ values: 'falsy' }).trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const status = req.body.status as PendenciaStatus | undefined
      const pendencia = await prisma.pendencia.update({
        where: { id: req.params.id },
        data: {
          ...(status !== undefined && {
            status,
            resolvedAt: status === PendenciaStatus.RESOLVIDA ? new Date() : null,
          }),
          ...(req.body.tipo !== undefined && { tipo: req.body.tipo }),
          ...(req.body.descricao !== undefined && { descricao: req.body.descricao || null }),
        },
      })
      res.json(pendencia)
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') {
        return res.status(404).json({ error: 'Pendência não encontrada' })
      }
      res.status(500).json({ error: 'Falha ao atualizar pendência' })
    }
  }
)

// POST /pendencias/:id/notas — adiciona anotação ao histórico
router.post(
  '/:id/notas',
  [body('texto').trim().notEmpty().withMessage('Texto é obrigatório')],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const user = req.user?.id
        ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } })
        : null
      const nota = await prisma.pendenciaNota.create({
        data: {
          pendenciaId: req.params.id,
          texto: req.body.texto,
          autor: user?.name ?? null,
        },
      })
      res.status(201).json(nota)
    } catch {
      res.status(500).json({ error: 'Falha ao salvar anotação' })
    }
  }
)

// DELETE /pendencias/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.pendencia.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') {
      return res.status(404).json({ error: 'Pendência não encontrada' })
    }
    res.status(500).json({ error: 'Falha ao excluir pendência' })
  }
})

export default router
