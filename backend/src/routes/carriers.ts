import { Router, Request, Response } from 'express'
import { body, param, validationResult } from 'express-validator'
import { prisma } from '../lib/prisma'

const router = Router()

// GET /carriers
router.get('/', async (_req: Request, res: Response) => {
  try {
    const carriers = await prisma.carrier.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { orders: true } } },
    })
    res.json(carriers)
  } catch {
    res.status(500).json({ error: 'Failed to fetch carriers' })
  }
})

// GET /carriers/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const carrier = await prisma.carrier.findUnique({
      where: { id: req.params.id },
      include: { orders: { orderBy: { createdAt: 'desc' }, take: 10 } },
    })
    if (!carrier) return res.status(404).json({ error: 'Carrier not found' })
    res.json(carrier)
  } catch {
    res.status(500).json({ error: 'Failed to fetch carrier' })
  }
})

// POST /carriers
router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('cnpj')
      .trim()
      .matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/)
      .withMessage('CNPJ must be in format XX.XXX.XXX/XXXX-XX'),
    body('phone').trim().notEmpty().withMessage('Phone is required'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const carrier = await prisma.carrier.create({
        data: { name: req.body.name, cnpj: req.body.cnpj, phone: req.body.phone },
      })
      res.status(201).json(carrier)
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
        return res.status(409).json({ error: 'CNPJ already registered' })
      }
      res.status(500).json({ error: 'Failed to create carrier' })
    }
  }
)

// PUT /carriers/:id
router.put(
  '/:id',
  [
    param('id').notEmpty(),
    body('name').optional().trim().notEmpty(),
    body('cnpj')
      .optional()
      .trim()
      .matches(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/),
    body('phone').optional().trim().notEmpty(),
    body('active').optional().isBoolean(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() })

    try {
      const carrier = await prisma.carrier.update({
        where: { id: req.params.id },
        data: {
          ...(req.body.name !== undefined && { name: req.body.name }),
          ...(req.body.cnpj !== undefined && { cnpj: req.body.cnpj }),
          ...(req.body.phone !== undefined && { phone: req.body.phone }),
          ...(req.body.active !== undefined && { active: req.body.active }),
        },
      })
      res.json(carrier)
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') {
        return res.status(404).json({ error: 'Carrier not found' })
      }
      res.status(500).json({ error: 'Failed to update carrier' })
    }
  }
)

// DELETE /carriers/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.carrier.delete({ where: { id: req.params.id } })
    res.status(204).send()
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2025') {
      return res.status(404).json({ error: 'Carrier not found' })
    }
    res.status(500).json({ error: 'Failed to delete carrier' })
  }
})

export default router
