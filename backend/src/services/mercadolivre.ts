import axios from 'axios'
import { prisma } from '../lib/prisma'
import { PendenciaOrigem, PendenciaTipo, Prisma } from '@prisma/client'
import { buscarNfPorNumeroLoja } from '../routes/bling'

// Chave da empresa no Bling (para buscar a NF do pedido ML)
const COMPANY_BLING_KEY: Record<MlCompany, string> = {
  avic: 'avic',
  agro: 'agrogranja',
}

// Empresas com conta no Mercado Livre. Credenciais do app ML via env (Railway):
//   AVIC_ML_CLIENT_ID / AVIC_ML_CLIENT_SECRET / AGRO_ML_CLIENT_ID / AGRO_ML_CLIENT_SECRET
export type MlCompany = 'avic' | 'agro'
export const ML_COMPANIES: MlCompany[] = ['avic', 'agro']

const COMPANY_CNPJ: Record<MlCompany, string> = {
  avic: '47715256000149',
  agro: '54695386000122',
}

function mlCreds(company: MlCompany): { clientId: string; clientSecret: string } | null {
  const prefix = company.toUpperCase()
  const clientId = process.env[`${prefix}_ML_CLIENT_ID`]?.trim()
  const clientSecret = process.env[`${prefix}_ML_CLIENT_SECRET`]?.trim()
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function mlRedirectUri(): string {
  const domain = process.env.ML_REDIRECT_BASE?.trim() || 'https://rastreio.avicswine.com.br'
  return `${domain.replace(/\/$/, '')}/api/ml/callback`
}

export function mlAuthUrl(company: MlCompany, state: string): string | null {
  const creds = mlCreds(company)
  if (!creds) return null
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: creds.clientId,
    redirect_uri: mlRedirectUri(),
    state,
  })
  return `https://auth.mercadolivre.com.br/authorization?${params.toString()}`
}

// Troca o code do OAuth por tokens e salva no banco
export async function mlExchangeCode(company: MlCompany, code: string): Promise<void> {
  const creds = mlCreds(company)
  if (!creds) throw new Error(`Credenciais ML não configuradas para ${company}`)

  const { data } = await axios.post(
    'https://api.mercadolibre.com/oauth/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      redirect_uri: mlRedirectUri(),
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
  )

  await prisma.mlToken.upsert({
    where: { companyKey: company },
    create: {
      companyKey: company,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: String(data.user_id),
      expiresAt: new Date(Date.now() + (data.expires_in ?? 21600) * 1000),
    },
    update: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      userId: String(data.user_id),
      expiresAt: new Date(Date.now() + (data.expires_in ?? 21600) * 1000),
    },
  })
}

// Retorna um access token válido, renovando se necessário (refresh token do ML é de uso único)
async function mlAccessToken(company: MlCompany): Promise<string | null> {
  const token = await prisma.mlToken.findUnique({ where: { companyKey: company } })
  if (!token) return null

  // margem de 5 min antes de expirar
  if (token.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return token.accessToken

  const creds = mlCreds(company)
  if (!creds) return null

  const { data } = await axios.post(
    'https://api.mercadolibre.com/oauth/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: token.refreshToken,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
  )

  await prisma.mlToken.update({
    where: { companyKey: company },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token, // novo — o anterior fica inválido
      expiresAt: new Date(Date.now() + (data.expires_in ?? 21600) * 1000),
    },
  })
  return data.access_token
}

export async function mlStatus(): Promise<Record<MlCompany, { configurado: boolean; autorizado: boolean; userId: string | null }>> {
  const result = {} as Record<MlCompany, { configurado: boolean; autorizado: boolean; userId: string | null }>
  for (const company of ML_COMPANIES) {
    const token = await prisma.mlToken.findUnique({ where: { companyKey: company } })
    result[company] = {
      configurado: mlCreds(company) !== null,
      autorizado: token !== null,
      userId: token?.userId ?? null,
    }
  }
  return result
}

interface MlClaim {
  id: number | string
  resource_id: number | string
  resource: string
  reason_id: string | null
  status: string
  stage: string
  date_created: string
  due_date?: string | null
  players?: { role?: string; available_actions?: { due_date?: string | null }[] }[]
}

// Prazo máximo do vendedor para agir na reclamação: menor due_date entre as
// ações disponíveis dos players que não são o comprador (complainant)
function extrairPrazoMl(claim: MlClaim): Date | null {
  const datas: number[] = []
  for (const pl of claim.players ?? []) {
    if (pl.role === 'complainant') continue
    for (const a of pl.available_actions ?? []) {
      if (a.due_date) {
        const t = new Date(a.due_date).getTime()
        if (!isNaN(t)) datas.push(t)
      }
    }
  }
  if (datas.length === 0 && claim.due_date) {
    const t = new Date(claim.due_date).getTime()
    if (!isNaN(t)) datas.push(t)
  }
  return datas.length > 0 ? new Date(Math.min(...datas)) : null
}

// Mensagens da reclamação (thread do pós-venda no ML)
export interface MlMensagem {
  de: 'comprador' | 'vendedor' | 'mediador'
  texto: string
  data: string | null
}

const CNPJ_TO_COMPANY: Record<string, MlCompany> = {
  '47715256000149': 'avic',
  '54695386000122': 'agro',
}

export async function mlClaimMessages(pendenciaId: string): Promise<MlMensagem[]> {
  const p = await prisma.pendencia.findUnique({
    where: { id: pendenciaId },
    select: { mlClaimId: true, senderCnpj: true },
  })
  if (!p?.mlClaimId) throw new Error('Pendência sem reclamação ML vinculada')
  const company = p.senderCnpj ? CNPJ_TO_COMPANY[p.senderCnpj.replace(/\D/g, '')] : undefined
  if (!company) throw new Error('Empresa da pendência não tem conta ML')
  const accessToken = await mlAccessToken(company)
  if (!accessToken) throw new Error(`Conta ML de ${company.toUpperCase()} não autorizada`)

  const { data } = await axios.get(
    `https://api.mercadolibre.com/post-purchase/v1/claims/${p.mlClaimId}/messages`,
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000 }
  )

  const lista = (Array.isArray(data) ? data : (data?.data ?? [])) as Record<string, unknown>[]
  return lista.map((m) => {
    const role = String(m.sender_role ?? '')
    return {
      de: role === 'complainant' ? 'comprador' as const : role === 'mediator' ? 'mediador' as const : 'vendedor' as const,
      texto: String(m.message ?? m.text ?? ''),
      data: (m.date_created as string | undefined) ?? null,
    }
  }).filter((m) => m.texto)
}

// Responde a RECLAMAÇÃO direto do painel (pedido José 02/09). Destinatário padrão é o
// comprador; em MEDIAÇÃO o ML exige mandar ao mediador — tenta o outro papel no erro.
export async function mlClaimResponder(pendenciaId: string, texto: string): Promise<void> {
  const p = await prisma.pendencia.findUnique({
    where: { id: pendenciaId },
    select: { mlClaimId: true, senderCnpj: true },
  })
  if (!p?.mlClaimId) throw new Error('Pendência sem reclamação ML vinculada')
  const company = p.senderCnpj ? CNPJ_TO_COMPANY[p.senderCnpj.replace(/\D/g, '')] : undefined
  if (!company) throw new Error('Empresa da pendência não tem conta ML')
  const accessToken = await mlAccessToken(company)
  if (!accessToken) throw new Error(`Conta ML de ${company.toUpperCase()} não autorizada`)
  const url = `https://api.mercadolibre.com/post-purchase/v1/claims/${p.mlClaimId}/actions/send-message`
  const H = { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000 }
  try {
    await axios.post(url, { receiver_role: 'complainant', message: texto }, H)
  } catch {
    await axios.post(url, { receiver_role: 'mediator', message: texto }, H)
  }
}

// Responde uma conversa PÓS-VENDA (mensagens do pack) direto do painel
export async function mlConversaResponder(company: MlCompany, packId: string, texto: string): Promise<void> {
  const auth = await mlAuth(company)
  if (!auth) throw new Error(`Conta ML de ${company.toUpperCase()} não autorizada`)
  let orderId = packId
  try {
    const { data: pack } = await axios.get(`https://api.mercadolibre.com/packs/${packId}`, auth.H)
    if (pack?.orders?.[0]?.id) orderId = String(pack.orders[0].id)
  } catch { /* pedido simples: o próprio id é a order */ }
  const { data: order } = await axios.get(`https://api.mercadolibre.com/orders/${orderId}`, auth.H)
  const buyerId = order?.buyer?.id
  if (!buyerId) throw new Error('Comprador não identificado no pedido')
  await axios.post(
    `https://api.mercadolibre.com/messages/packs/${packId}/sellers/${auth.userId}?tag=post_sale`,
    { from: { user_id: String(auth.userId) }, to: { user_id: String(buyerId) }, text: texto },
    auth.H
  )
}

// Conversas pós-venda SEM RESPOSTA do vendedor (lidas ou não) — o que o ML não
// notifica direito. Rastreadas em banco (ml_conversas_pendentes) via varredura de
// pedidos recentes + checagem periódica. mark_as_read=false: consultar pelo painel
// NÃO marca como lida no ML.
export interface MlConversa {
  company: string          // AVIC | AGRO
  packId: string
  comprador: string
  item: string
  naoLidas: number         // msgs do comprador sem resposta no fim da conversa
  mensagens: MlMensagem[]  // até 10, da mais antiga para a mais recente
}

const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type MlAuth = { userId: string; H: { headers: { Authorization: string }; timeout: number } }

export async function mlAuth(company: MlCompany): Promise<MlAuth | null> {
  const token = await prisma.mlToken.findUnique({ where: { companyKey: company } })
  if (!token) return null
  const accessToken = await mlAccessToken(company)
  if (!accessToken) return null
  return { userId: token.userId, H: { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000 } }
}

// Lê a thread de um pack e devolve o estado da conversa (null = sem mensagens)
async function lerConversa(auth: MlAuth, company: MlCompany, packId: string): Promise<{
  mensagens: MlMensagem[]; ultimaDe: 'comprador' | 'vendedor'; seguidas: number; ultimaEm: Date | null
  comprador: string; item: string
} | null> {
  const { data: th } = await axios.get(
    `https://api.mercadolibre.com/messages/packs/${packId}/sellers/${auth.userId}?tag=post_sale&mark_as_read=false&limit=10`, auth.H)
  const msgs = (th?.messages ?? []) as { from?: { user_id?: unknown }; text?: unknown; message_date?: { received?: string; created?: string } }[]

  const mensagens = msgs
    .map((m) => ({
      de: String(m.from?.user_id ?? '') === String(auth.userId) ? 'vendedor' as const : 'comprador' as const,
      texto: String(m.text ?? ''),
      data: m.message_date?.received ?? m.message_date?.created ?? null,
    }))
    .filter((m) => m.texto)
    .sort((a, b) => String(a.data ?? '').localeCompare(String(b.data ?? '')))
  if (mensagens.length === 0) return null

  const ultima = mensagens[mensagens.length - 1]
  let seguidas = 0
  for (let i = mensagens.length - 1; i >= 0 && mensagens[i].de === 'comprador'; i--) seguidas++

  // Comprador + item: o pack aponta a order (pedido simples: o próprio id é a order)
  let comprador = 'Cliente ML'
  let item = ''
  let orderId = packId
  try {
    const { data: pack } = await axios.get(`https://api.mercadolibre.com/packs/${packId}`, auth.H)
    if (pack?.orders?.[0]?.id) orderId = String(pack.orders[0].id)
  } catch { /* sem pack — o próprio id é a order */ }
  try {
    const { data: order } = await axios.get(`https://api.mercadolibre.com/orders/${orderId}`, auth.H)
    const buyer = order?.buyer
    comprador = [buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') || buyer?.nickname || comprador
    item = order?.order_items?.[0]?.item?.title ?? ''
  } catch { /* segue sem enriquecer */ }

  return {
    mensagens, ultimaDe: ultima.de === 'vendedor' ? 'vendedor' : 'comprador', seguidas,
    ultimaEm: ultima.data ? new Date(ultima.data) : null, comprador, item,
  }
}

async function upsertConversa(company: MlCompany, packId: string, conv: NonNullable<Awaited<ReturnType<typeof lerConversa>>>) {
  const pendente = conv.ultimaDe === 'comprador'
  await prisma.mlConversaPendente.upsert({
    where: { packId },
    create: {
      packId, company: company.toUpperCase(), comprador: conv.comprador, item: conv.item || null,
      naoLidas: conv.seguidas, mensagens: conv.mensagens as unknown as Prisma.InputJsonValue, ultimaEm: conv.ultimaEm, respondida: !pendente,
    },
    update: {
      comprador: conv.comprador, item: conv.item || null,
      naoLidas: conv.seguidas, mensagens: conv.mensagens as unknown as Prisma.InputJsonValue, ultimaEm: conv.ultimaEm, respondida: !pendente,
    },
  })
  return pendente
}

// Varredura completa: percorre os pedidos dos últimos N dias e registra as conversas
// em que a última mensagem é do comprador (sem resposta) — pega inclusive as já lidas.
export async function mlVarrerMensagens(dias = 30): Promise<{ verificadas: number; pendentes: number; erros: string[] }> {
  let verificadas = 0
  let pendentes = 0
  const erros: string[] = []

  for (const company of ML_COMPANIES) {
    try {
      const auth = await mlAuth(company)
      if (!auth) continue
      const from = new Date(Date.now() - dias * 86400000).toISOString()

      const packs = new Set<string>()
      for (let offset = 0; offset < 500; offset += 50) {
        const { data } = await axios.get('https://api.mercadolibre.com/orders/search', {
          ...auth.H,
          params: { seller: auth.userId, sort: 'date_desc', limit: 50, offset, 'order.date_created.from': from },
        })
        const results = (data?.results ?? []) as { id?: unknown; pack_id?: unknown }[]
        for (const o of results) packs.add(String(o.pack_id ?? o.id ?? '').replace(/\D/g, ''))
        if (results.length < 50) break
        await dorme(150)
      }
      packs.delete('')

      for (const packId of packs) {
        try {
          const conv = await lerConversa(auth, company, packId)
          verificadas++
          if (conv && await upsertConversa(company, packId, conv)) pendentes++
        } catch (e) {
          if (!(axios.isAxiosError(e) && e.response?.status === 404)) {
            erros.push(`${company}/${packId}: ${axios.isAxiosError(e) ? `HTTP ${e.response?.status}` : String(e)}`)
          }
        }
        await dorme(120)
      }
    } catch (e) {
      erros.push(`${company}: ${axios.isAxiosError(e) ? `HTTP ${e.response?.status}` : String(e)}`)
    }
  }

  console.log(`[ML] Varredura de mensagens: ${verificadas} conversas verificadas, ${pendentes} sem resposta`)
  return { verificadas, pendentes, erros }
}

// Checagem leve e frequente: novas não lidas + reconfere as pendentes registradas
// (marca respondida quando o vendedor respondeu no ML).
export async function mlAtualizarPendentes(): Promise<void> {
  for (const company of ML_COMPANIES) {
    try {
      const auth = await mlAuth(company)
      if (!auth) continue

      // 1) não lidas novas → registra
      const { data: unread } = await axios.get(
        'https://api.mercadolibre.com/messages/unread?role=seller&tag=post_sale', auth.H)
      for (const r of ((unread?.results ?? []) as { resource?: string }[]).slice(0, 20)) {
        const packId = String(r.resource ?? '').replace(/\D/g, '')
        if (!packId) continue
        try {
          const conv = await lerConversa(auth, company, packId)
          if (conv) await upsertConversa(company, packId, conv)
        } catch { /* ignora conversa individual */ }
        await dorme(120)
      }

      // 2) pendentes registradas → reconfere se foram respondidas
      const abertas = await prisma.mlConversaPendente.findMany({
        where: { respondida: false, company: company.toUpperCase() },
        take: 30,
      })
      for (const p of abertas) {
        try {
          const conv = await lerConversa(auth, company, p.packId)
          if (conv) await upsertConversa(company, p.packId, conv)
        } catch { /* ignora conversa individual */ }
        await dorme(120)
      }
    } catch (err) {
      console.error(`[ML] Erro na checagem de mensagens (${company}):`, axios.isAxiosError(err) ? err.response?.status : err)
    }
  }
}

// Lista para o painel — direto do banco (rápido, sem bater no ML)
export async function mlConversasPendentes(): Promise<{ conversas: MlConversa[]; erros: string[] }> {
  const rows = await prisma.mlConversaPendente.findMany({
    where: { respondida: false },
    orderBy: { ultimaEm: 'desc' },
  })
  return {
    conversas: rows.map((r) => ({
      company: r.company,
      packId: r.packId,
      comprador: r.comprador,
      item: r.item ?? '',
      naoLidas: r.naoLidas,
      mensagens: (Array.isArray(r.mensagens) ? r.mensagens : []) as unknown as MlMensagem[],
    })),
    erros: [],
  }
}

// Busca reclamações abertas no ML e cria pendências (dedup por mlClaimId)
export async function syncMlClaims(): Promise<{ criadas: number; erros: string[] }> {
  let criadas = 0
  const erros: string[] = []

  for (const company of ML_COMPANIES) {
    try {
      const accessToken = await mlAccessToken(company)
      if (!accessToken) continue // empresa não autorizada ainda

      const { data } = await axios.get('https://api.mercadolibre.com/post-purchase/v1/claims/search', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { status: 'opened' },
        timeout: 20000,
      })

      const claims = (data?.data ?? []) as MlClaim[]
      for (const claim of claims) {
        const claimId = String(claim.id)
        const dataAberturaMl = claim.date_created ? new Date(claim.date_created) : null
        const prazoMl = extrairPrazoMl(claim)
        const jaExiste = await prisma.pendencia.findUnique({ where: { mlClaimId: claimId } })
        if (jaExiste) {
          const updates: Record<string, unknown> = {}
          // Corrige a data de pendências antigas gravadas com a hora do sync
          if (dataAberturaMl && Math.abs(jaExiste.createdAt.getTime() - dataAberturaMl.getTime()) > 3600000) {
            updates.createdAt = dataAberturaMl
          }
          // Prazo de resposta muda conforme a reclamação avança — mantém atualizado
          if ((prazoMl?.getTime() ?? null) !== (jaExiste.mlDueDate?.getTime() ?? null)) {
            updates.mlDueDate = prazoMl
          }
          if (Object.keys(updates).length > 0) {
            await prisma.pendencia.update({ where: { id: jaExiste.id }, data: updates })
          }
          continue
        }

        // Enriquece com dados da venda (comprador + item) — best-effort
        let comprador = 'Cliente Mercado Livre'
        let item = ''
        let packId: string | null = null
        if (claim.resource === 'order' && claim.resource_id) {
          try {
            const { data: order } = await axios.get(
              `https://api.mercadolibre.com/orders/${claim.resource_id}`,
              { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 }
            )
            const buyer = order?.buyer
            comprador = [buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') || buyer?.nickname || comprador
            item = order?.order_items?.[0]?.item?.title ?? ''
            packId = order?.pack_id ? String(order.pack_id) : null
          } catch { /* segue sem enriquecer */ }
        }

        // NF do pedido no Bling (numeroLoja = id do pedido/pack ML) — best-effort
        const mlOrderId = claim.resource_id ? String(claim.resource_id) : null
        const nfNumber = mlOrderId
          ? await buscarNfPorNumeroLoja(COMPANY_BLING_KEY[company], [mlOrderId, ...(packId ? [packId] : [])])
          : null

        await prisma.pendencia.create({
          data: {
            customerName: comprador,
            senderCnpj: COMPANY_CNPJ[company],
            tipo: PendenciaTipo.RECLAMACAO_ML,
            origem: PendenciaOrigem.MERCADO_LIVRE,
            mlClaimId: claimId,
            mlOrderId,
            nfNumber,
            mlDueDate: prazoMl,
            ...(dataAberturaMl && { createdAt: dataAberturaMl }), // data real de abertura no ML
            descricao: [
              item && `Item: ${item}`,
              claim.reason_id && `Motivo: ${claim.reason_id}`,
              `Etapa: ${claim.stage} | Aberta em ${new Date(claim.date_created).toLocaleDateString('pt-BR')}`,
            ].filter(Boolean).join('\n'),
          },
        })
        criadas++
        console.log(`[ML] Reclamação ${claimId} (${company.toUpperCase()}) → pendência criada${nfNumber ? ` (NF ${nfNumber})` : ''}`)
      }

      // Retro-preenche a NF de pendências ML antigas que ficaram sem número
      const semNf = await prisma.pendencia.findMany({
        where: {
          origem: PendenciaOrigem.MERCADO_LIVRE,
          senderCnpj: COMPANY_CNPJ[company],
          nfNumber: null,
          mlOrderId: { not: null },
        },
        take: 20,
      })
      for (const p of semNf) {
        // O numeroLoja no Bling guarda o pack_id do ML — busca no pedido antes de cruzar
        const candidatos = [p.mlOrderId!]
        try {
          const { data: order } = await axios.get(
            `https://api.mercadolibre.com/orders/${p.mlOrderId}`,
            { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 }
          )
          if (order?.pack_id) candidatos.push(String(order.pack_id))
        } catch { /* segue só com o id do pedido */ }
        const nf = await buscarNfPorNumeroLoja(COMPANY_BLING_KEY[company], candidatos)
        if (nf) {
          await prisma.pendencia.update({ where: { id: p.id }, data: { nfNumber: nf } })
          console.log(`[ML] Pendência ${p.mlClaimId} → NF ${nf} vinculada retroativamente`)
        }
      }
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `${company}: HTTP ${err.response?.status ?? '?'} ${JSON.stringify(err.response?.data ?? err.message).slice(0, 200)}`
        : `${company}: ${String(err)}`
      erros.push(msg)
      console.error(`[ML] Erro no sync de reclamações — ${msg}`)
    }
  }

  return { criadas, erros }
}
