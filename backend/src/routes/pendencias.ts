import { Router, Request, Response } from 'express'
import { body, query, validationResult } from 'express-validator'
import { prisma } from '../lib/prisma'
import { PendenciaTipo, PendenciaStatus, PendenciaOrigem, Prisma } from '@prisma/client'
import { buscarNfNoBling, listarEmpresasBling, blingGet } from './bling'

const router = Router()

// GET /pendencias?status=&tipo=&empresa=&origem=&search=
router.get(
  '/',
  [
    // Aceita um ou mais status separados por vírgula (ex: status=ABERTA,EM_TRATAMENTO)
    query('status').optional().custom((v: string) =>
      String(v).split(',').every((s) => (Object.values(PendenciaStatus) as string[]).includes(s))
    ),
    query('tipo').optional().isIn(Object.values(PendenciaTipo)),
    query('empresa').optional().trim(),
    // Aceita uma ou mais origens separadas por vírgula (ex: origem=AUTO,MANUAL)
    query('origem').optional().custom((v: string) =>
      String(v).split(',').every((o) => (Object.values(PendenciaOrigem) as string[]).includes(o))
    ),
    query('search').optional().trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const where: Prisma.PendenciaWhereInput = {}
    if (req.query.status) {
      const sts = String(req.query.status).split(',') as PendenciaStatus[]
      where.status = sts.length === 1 ? sts[0] : { in: sts }
    }
    if (req.query.tipo) where.tipo = req.query.tipo as PendenciaTipo
    if (req.query.empresa) where.senderCnpj = req.query.empresa as string
    if (req.query.origem) {
      const origens = String(req.query.origem).split(',') as PendenciaOrigem[]
      where.origem = origens.length === 1 ? origens[0] : { in: origens }
    }
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
    body('responsavel').optional({ values: 'falsy' }).trim(),
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
          senderCnpj: req.body.senderCnpj ? String(req.body.senderCnpj).replace(/\D/g, '') : null,
          tipo: req.body.tipo,
          origem: PendenciaOrigem.MANUAL,
          descricao: req.body.descricao || null,
          responsavel: req.body.responsavel || null,
        },
        include: { order: { select: { orderNumber: true } } },
      })
      res.status(201).json(pendencia)
    } catch {
      res.status(500).json({ error: 'Falha ao criar pendência' })
    }
  }
)

// PATCH /pendencias/bulk — altera status/responsável de várias de uma vez
// (registrado antes de /:id para 'bulk' não ser interpretado como id)
router.patch(
  '/bulk',
  [
    body('ids').isArray({ min: 1 }).withMessage('Informe ids: string[]'),
    body('status').optional().isIn(Object.values(PendenciaStatus)),
    body('responsavel').optional({ values: 'falsy' }).trim(),
    body('nota').optional({ values: 'falsy' }).trim(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    const ids = (req.body.ids as string[]).filter((i) => typeof i === 'string')
    const status = req.body.status as PendenciaStatus | undefined
    if (!status && !req.body.responsavel) {
      return res.status(400).json({ error: 'Informe status e/ou responsavel' })
    }

    try {
      const result = await prisma.pendencia.updateMany({
        where: { id: { in: ids } },
        data: {
          ...(status !== undefined && {
            status,
            resolvedAt: status === PendenciaStatus.RESOLVIDA ? new Date() : null,
          }),
          ...(req.body.responsavel && { responsavel: req.body.responsavel }),
        },
      })

      // Nota opcional (ex: texto de conclusão) replicada em cada pendência
      if (req.body.nota) {
        const user = req.user?.id
          ? await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } })
          : null
        await prisma.pendenciaNota.createMany({
          data: ids.map((pendenciaId) => ({ pendenciaId, texto: req.body.nota, autor: user?.name ?? null })),
        })
      }

      res.json({ atualizadas: result.count })
    } catch {
      res.status(500).json({ error: 'Falha na atualização em massa' })
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
    body('responsavel').optional({ values: 'null' }).trim(),
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
          ...(req.body.responsavel !== undefined && { responsavel: req.body.responsavel || null }),
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

// GET /pendencias/:id/danfe — resolve a URL do DANFE (painel ou Bling) para abrir a NF em PDF
router.get('/:id/danfe', async (req: Request, res: Response) => {
  try {
    const p = await prisma.pendencia.findUnique({
      where: { id: req.params.id },
      include: { order: { select: { linkDanfe: true } } },
    })
    if (!p) return res.status(404).json({ error: 'Pendência não encontrada' })
    if (p.order?.linkDanfe) return res.json({ url: p.order.linkDanfe })
    if (!p.nfNumber) return res.status(404).json({ error: 'Pendência sem NF' })

    // Pedido no painel com a mesma NF/empresa
    const order = await prisma.order.findFirst({
      where: {
        nfNumber: { in: [p.nfNumber, p.nfNumber.padStart(6, '0'), String(parseInt(p.nfNumber, 10))] },
        ...(p.senderCnpj && { senderCnpj: p.senderCnpj }),
        linkDanfe: { not: null },
      },
      select: { linkDanfe: true },
    })
    if (order?.linkDanfe) return res.json({ url: order.linkDanfe })

    // Direto no Bling: acha a NF pelo número e pega o linkDanfe no detalhe
    const companyKey = p.senderCnpj
      ? listarEmpresasBling().find((e) => e.cnpj === p.senderCnpj)?.key
      : undefined
    const matches = await buscarNfNoBling(p.nfNumber, companyKey)
    if (matches[0]) {
      const det = (await blingGet(matches[0].companyKey, `/nfe/${matches[0].blingId}`)) as { data?: { linkDanfe?: string } }
      if (det?.data?.linkDanfe) return res.json({ url: det.data.linkDanfe })
    }

    res.status(404).json({ error: 'DANFE não encontrado' })
  } catch {
    res.status(500).json({ error: 'Falha ao buscar DANFE' })
  }
})

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
