import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { mlAuthUrl, mlExchangeCode, mlStatus, syncMlClaims, mlClaimMessages, mlClaimResponder, mlConversaResponder, mlConversasPendentes, mlVarrerMensagens, mlAtualizarClaim, mlReconciliarClaims, ML_COMPANIES, type MlCompany } from '../services/mercadolivre'
import { cicloEnviosMl, notificarStatusMl, PORTAL_URL, TRACKING_MSG, TRACKING_COMENTARIO, type MlEnvioStatus } from '../services/mlEnvios'
import { prisma } from '../lib/prisma'

// Rotas autenticadas (montadas com requireAuth)
const router = Router()

// Estados OAuth pendentes: state → { company, expiresAt } (anti-CSRF, validade 10 min)
const pendingStates = new Map<string, { company: MlCompany; expiresAt: number }>()

function cleanExpiredStates() {
  const now = Date.now()
  for (const [state, info] of pendingStates) {
    if (info.expiresAt < now) pendingStates.delete(state)
  }
}

// GET /ml/status — situação da integração por empresa
router.get('/status', async (_req: Request, res: Response) => {
  res.json(await mlStatus())
})

// GET /ml/auth/:company — devolve a URL de autorização no ML
router.get('/auth/:company', (req: Request, res: Response) => {
  const company = req.params.company as MlCompany
  if (!ML_COMPANIES.includes(company)) return res.status(400).json({ error: 'Empresa inválida' })

  cleanExpiredStates()
  const state = `${company}:${crypto.randomBytes(16).toString('hex')}`
  pendingStates.set(state, { company, expiresAt: Date.now() + 10 * 60 * 1000 })

  const url = mlAuthUrl(company, state)
  if (!url) return res.status(400).json({ error: `Credenciais ML de ${company.toUpperCase()} não configuradas (env)` })
  res.json({ url })
})

// POST /ml/sync — sincroniza reclamações agora (novas + estado das já existentes)
router.post('/sync', async (_req: Request, res: Response) => {
  const result = await syncMlClaims()
  const reconc = await mlReconciliarClaims()
  res.json({ ...result, ...reconc })
})

// POST /ml/claims/reconciliar — reconfere no ML o estado das pendências abertas
// (fecha no painel o que já foi resolvido lá). Roda sozinho a cada 30 min.
router.post('/claims/reconciliar', async (_req: Request, res: Response) => {
  res.json(await mlReconciliarClaims())
})

// GET /ml/mensagens — conversas pós-venda sem resposta (do banco; rápido)
router.get('/mensagens', async (_req: Request, res: Response) => {
  try {
    res.json(await mlConversasPendentes())
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha ao buscar mensagens' })
  }
})

// POST /ml/mensagens/varrer — varre os pedidos dos últimos N dias no ML (pega
// também mensagens já lidas mas sem resposta). Pode levar 1-2 min.
router.post('/mensagens/varrer', async (req: Request, res: Response) => {
  const dias = Math.max(7, Math.min(Number(req.body?.dias) || 30, 60))
  try {
    res.json(await mlVarrerMensagens(dias))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha na varredura' })
  }
})

// GET /ml/pendencias/:id/mensagens — thread de mensagens da reclamação no ML
router.get('/pendencias/:id/mensagens', async (req: Request, res: Response) => {
  try {
    const mensagens = await mlClaimMessages(req.params.id)
    res.json({ mensagens })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao buscar mensagens' })
  }
})

// POST /ml/pendencias/:id/responder — responde a reclamação direto do painel
router.post('/pendencias/:id/responder', async (req: Request, res: Response) => {
  const texto = String(req.body?.texto ?? '').trim()
  if (!texto) { res.status(400).json({ error: 'Escreva a mensagem' }); return }
  try {
    await mlClaimResponder(req.params.id, texto.slice(0, 2000))
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao responder' })
  }
})

// POST /ml/conversas/:company/:packId/responder — responde o pós-venda direto do painel
router.post('/conversas/:company/:packId/responder', async (req: Request, res: Response) => {
  const texto = String(req.body?.texto ?? '').trim()
  const company = String(req.params.company ?? '').toLowerCase() as MlCompany
  if (!texto) { res.status(400).json({ error: 'Escreva a mensagem' }); return }
  if (!ML_COMPANIES.includes(company)) { res.status(400).json({ error: 'Empresa inválida' }); return }
  try {
    await mlConversaResponder(company, req.params.packId, texto.slice(0, 2000))
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao responder' })
  }
})

// ── Mercado Envios 1: avisa o ML do andamento do envio (obrigatório p/ o vendedor) ──

// GET /ml/envios/pendentes — o que está esperando ser avisado ao ML
router.get('/envios/pendentes', async (_req: Request, res: Response) => {
  const pendentes = await prisma.order.findMany({
    where: { mlShipmentId: { not: null } },
    select: {
      id: true, orderNumber: true, nfNumber: true, customerName: true, status: true,
      shippedAt: true, deliveredAt: true, lastTracking: true, mlCompany: true,
      mlOrderId: true, mlShipmentId: true, mlShippedNotifiedAt: true,
      mlDeliveredNotifiedAt: true, mlEnvioErro: true,
    },
    orderBy: { shippedAt: 'desc' },
    take: 100,
  })
  res.json({
    pendentes,
    config: { portalUrl: PORTAL_URL, trackingMsg: TRACKING_MSG, trackingComentario: TRACKING_COMENTARIO, auto: process.env.ML_ENVIOS_AUTO === '1' },
  })
})

// POST /ml/envios/sincronizar — casa vendas ME1 e avisa o ML. { dryRun: true } só simula.
router.post('/envios/sincronizar', async (req: Request, res: Response) => {
  const dryRun = req.body?.dryRun !== false   // padrão SIMULA: disparo real é explícito
  try {
    res.json(await cicloEnviosMl(dryRun))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Falha no ciclo ME1' })
  }
})

// POST /ml/envios/:orderId/notificar — disparo manual de um pedido específico
router.post('/envios/:orderId/notificar', async (req: Request, res: Response) => {
  const status = String(req.body?.status ?? '') as MlEnvioStatus
  if (!['shipped', 'delivered', 'not_delivered'].includes(status)) {
    res.status(400).json({ error: 'status deve ser shipped, delivered ou not_delivered' }); return
  }
  const order = await prisma.order.findUnique({
    where: { id: req.params.orderId },
    select: { id: true, mlCompany: true, mlShipmentId: true, shippedAt: true, deliveredAt: true, lastTracking: true },
  })
  if (!order?.mlShipmentId || !order.mlCompany) {
    res.status(400).json({ error: 'Pedido sem venda ME1 vinculada' }); return
  }
  try {
    await notificarStatusMl(order.mlCompany as MlCompany, order.mlShipmentId, status, {
      date: status === 'delivered' ? order.deliveredAt : order.shippedAt,
      substatus: req.body?.substatus ?? null,
      comment: status === 'shipped' ? TRACKING_COMENTARIO : (order.lastTracking ?? undefined),
      comTracking: status === 'shipped',
    })
    await prisma.order.update({
      where: { id: order.id },
      data: {
        mlEnvioErro: null,
        ...(status === 'shipped' ? { mlShippedNotifiedAt: new Date() } : {}),
        ...(status === 'delivered' ? { mlDeliveredNotifiedAt: new Date() } : {}),
      },
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Falha ao notificar' })
  }
})

// Router público — callback do OAuth (o navegador chega sem nosso JWT)
export const mlPublicRouter = Router()

// ── Caixa de entrada das notificações do ML para o cmvsync ───────────────────────────
// O cmvsync roda no PC do José, sem URL pública. O ML entrega aqui (endereço fixo do
// Railway) e o cmvsync busca de poucos em poucos segundos — PC desligado não perde nada.
// Responde 200 sempre e na hora: o ML reenvia por dias quando não recebe 200.
// Tópicos que o cmvsync realmente consome hoje. O ML pode ficar com TODOS marcados (é
// melhor: não precisa voltar ao painel a cada evolução), mas só estes entram na fila —
// senão uma enxurrada de avisos inúteis atrasaria os de preço, que são o que importa.
// Para habilitar um tópico novo, acrescente aqui (ou na env ML_NOTIF_TOPICS).
const TOPICOS_ACEITOS = new Set(
  (process.env.ML_NOTIF_TOPICS?.trim() ||
   'items,items_prices,price_suggestion,prices,promotions,seller_promotions')
    .split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
)
let _notifIgnoradas = 0

// Tópicos de pós-venda que o PAINEL consome na hora (não vão para a fila do cmvsync):
// mantêm a pendência espelhando o estado da reclamação no ML.
const TOPICOS_POS_VENDA = new Set(['claims', 'post_purchase', 'returns', 'claims_actions'])

mlPublicRouter.post('/notificacoes', async (req: Request, res: Response) => {
  res.status(200).send('')          // responde primeiro; grava depois
  const b = (req.body ?? {}) as Record<string, unknown>
  const resource = String(b.resource ?? '')
  const topic = String(b.topic ?? 'items').toLowerCase()
  if (!resource) return

  // Pós-venda: atualiza a pendência imediatamente (fechou no ML → resolve no painel)
  if (TOPICOS_POS_VENDA.has(topic)) {
    const claimId = resource.match(/(\d{6,})/)?.[1]
    if (claimId) {
      mlAtualizarClaim(claimId, b.user_id != null ? String(b.user_id) : null)
        .catch((err) => console.error(`[ML notif] claim ${claimId}:`, err instanceof Error ? err.message : err))
    }
    return
  }

  if (!TOPICOS_ACEITOS.has(topic)) {
    // descartado de propósito: conta e registra de vez em quando, p/ sabermos o volume
    if (++_notifIgnoradas % 200 === 1) {
      console.log(`[ML notif] ${_notifIgnoradas} aviso(s) de tópico não usado descartado(s) (último: ${topic})`)
    }
    return
  }
  try {
    await prisma.mlNotificacao.create({
      data: {
        topic,
        resource,
        mlUserId: b.user_id != null ? String(b.user_id) : null,
        payload: b as object,
      },
    })
  } catch (err) {
    console.error('[ML notif] falha ao gravar:', err instanceof Error ? err.message : err)
  }
})

// O cmvsync chama esta rota em loop curto. Protegida por um segredo compartilhado
// (ML_NOTIF_TOKEN) porque devolve e consome a fila.
mlPublicRouter.get('/notificacoes/pendentes', async (req: Request, res: Response) => {
  const esperado = process.env.ML_NOTIF_TOKEN?.trim()
  if (!esperado || String(req.query.token ?? '') !== esperado) {
    res.status(401).json({ error: 'token inválido' }); return
  }
  const limite = Math.min(Number(req.query.limit) || 100, 300)
  const pend = await prisma.mlNotificacao.findMany({
    where: { entregueEm: null },
    orderBy: { recebidoEm: 'asc' },
    take: limite,
  })
  if (pend.length) {
    await prisma.mlNotificacao.updateMany({
      where: { id: { in: pend.map((p) => p.id) } },
      data: { entregueEm: new Date() },
    })
  }
  // limpeza: entregues com mais de 2 dias não servem para nada
  prisma.mlNotificacao.deleteMany({
    where: { entregueEm: { lt: new Date(Date.now() - 2 * 86400_000) } },
  }).catch(() => {})
  res.json({ notificacoes: pend.map((p) => ({
    topic: p.topic, resource: p.resource, user_id: p.mlUserId, recebido_em: p.recebidoEm,
  })) })
})

mlPublicRouter.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined
  const state = req.query.state as string | undefined

  const known = state ? pendingStates.get(state) : undefined
  if (!code || !known) {
    return res.status(400).send('<h3>Autorização inválida ou expirada. Tente novamente pelo painel.</h3>')
  }
  pendingStates.delete(state as string)

  try {
    await mlExchangeCode(known.company, code)
    res.send(`<h3>✅ Mercado Livre autorizado para ${known.company.toUpperCase()}. Pode fechar esta aba.</h3>`)
  } catch (err) {
    console.error('[ML] Erro no callback OAuth:', err)
    res.status(500).send('<h3>Erro ao concluir a autorização. Veja os logs.</h3>')
  }
})

export default router
