/**
 * Leitura do DIFAL pago para o cmvsync (painel de Vendas), aprovado pelo José em 20/11/2026.
 * Só leitura e só o necessário: empresa, NF, número do pedido na loja, valor pago e data. Sem nome nem CPF.
 * Protegido por chave própria (DIFAL_CHAVE_CMVSYNC, a mesma no .env do cmvsync); sem a variável, a rota fica desligada.
 */
import { Router, Request, Response } from 'express'
import { timingSafeEqual } from 'crypto'
import { prisma } from '../lib/prisma'

const router = Router()

function chaveConfere(recebida: string | undefined): boolean {
  const esperada = process.env.DIFAL_CHAVE_CMVSYNC
  if (!esperada || !recebida) return false
  const a = Buffer.from(recebida)
  const b = Buffer.from(esperada)
  return a.length === b.length && timingSafeEqual(a, b)
}

// GET /api/difal-externo/pagas?desde=AAAA-MM-DD — guias marcadas como pagas, por data de emissão da NF
router.get('/pagas', async (req: Request, res: Response) => {
  if (!chaveConfere(req.header('x-chave-difal'))) return res.status(401).json({ erro: 'chave inválida' })
  const desde = String(req.query.desde ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return res.status(400).json({ erro: 'informe desde=AAAA-MM-DD' })
  try {
    const notas = await prisma.difalNota.findMany({
      // emitidaEm guarda Brasília como se fosse UTC: a meia-noite UTC é o começo do dia da nota
      where: { guiaPagaEm: { not: null }, difalPagoGuia: { gt: 0 }, emitidaEm: { gte: new Date(`${desde}T00:00:00Z`) } },
      select: { empresa: true, nfNumero: true, mlOrderId: true, valorNota: true, difalPagoGuia: true, guiaPagaEm: true, emitidaEm: true },
      orderBy: { emitidaEm: 'asc' },
    })
    res.json(notas.map((n) => ({
      empresa: n.empresa,
      nf: n.nfNumero,
      // número do pedido na loja (ML, site, Shopee) como veio do Bling; balcão não tem
      pedidoLoja: n.mlOrderId,
      emitidaEm: n.emitidaEm.toISOString().slice(0, 10),
      valorNota: n.valorNota,
      difalPago: n.difalPagoGuia,
      pagoEm: n.guiaPagaEm!.toISOString().slice(0, 10),
    })))
  } catch (e) {
    res.status(500).json({ erro: (e as Error).message.split('\n')[0] })
  }
})

export default router
