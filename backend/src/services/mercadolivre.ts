import axios from 'axios'
import { prisma } from '../lib/prisma'
import { PendenciaOrigem, PendenciaTipo } from '@prisma/client'
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

// Conversas pós-venda com mensagens NÃO LIDAS — o que o ML não notifica direito.
// mark_as_read=false: consultar pelo painel NÃO marca como lida no ML.
export interface MlConversa {
  company: string          // AVIC | AGRO
  packId: string
  comprador: string
  item: string
  naoLidas: number
  mensagens: MlMensagem[]  // até 10, da mais antiga para a mais recente
}

export async function mlMensagensNaoLidas(): Promise<{ conversas: MlConversa[]; erros: string[] }> {
  const conversas: MlConversa[] = []
  const erros: string[] = []

  for (const company of ML_COMPANIES) {
    try {
      const token = await prisma.mlToken.findUnique({ where: { companyKey: company } })
      if (!token) continue
      const accessToken = await mlAccessToken(company)
      if (!accessToken) continue
      const H = { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 20000 }

      const { data: unread } = await axios.get(
        'https://api.mercadolibre.com/messages/unread?role=seller&tag=post_sale', H)
      const results = (unread?.results ?? []) as { resource?: string; count?: number }[]

      for (const r of results.slice(0, 20)) {
        const packId = String(r.resource ?? '').replace(/\D/g, '')
        if (!packId) continue
        try {
          const { data: th } = await axios.get(
            `https://api.mercadolibre.com/messages/packs/${packId}/sellers/${token.userId}?tag=post_sale&mark_as_read=false&limit=10`, H)
          const msgs = (th?.messages ?? []) as { from?: { user_id?: unknown }; text?: unknown; message_date?: { received?: string; created?: string } }[]

          // Comprador + item: o pack aponta a order (pedido simples: o próprio id é a order)
          let comprador = 'Cliente ML'
          let item = ''
          let orderId = packId
          try {
            const { data: pack } = await axios.get(`https://api.mercadolibre.com/packs/${packId}`, H)
            if (pack?.orders?.[0]?.id) orderId = String(pack.orders[0].id)
          } catch { /* sem pack — segue com o próprio id */ }
          try {
            const { data: order } = await axios.get(`https://api.mercadolibre.com/orders/${orderId}`, H)
            const buyer = order?.buyer
            comprador = [buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') || buyer?.nickname || comprador
            item = order?.order_items?.[0]?.item?.title ?? ''
          } catch { /* segue sem enriquecer */ }

          const mensagens = msgs
            .map((m) => ({
              de: String(m.from?.user_id ?? '') === String(token.userId) ? 'vendedor' as const : 'comprador' as const,
              texto: String(m.text ?? ''),
              data: m.message_date?.received ?? m.message_date?.created ?? null,
            }))
            .filter((m) => m.texto)
            .sort((a, b) => String(a.data ?? '').localeCompare(String(b.data ?? '')))

          conversas.push({
            company: company.toUpperCase(),
            packId, comprador, item,
            naoLidas: r.count ?? 1,
            mensagens,
          })
        } catch (e) {
          erros.push(`${company}/${packId}: ${axios.isAxiosError(e) ? `HTTP ${e.response?.status}` : String(e)}`)
        }
      }
    } catch (e) {
      erros.push(`${company}: ${axios.isAxiosError(e) ? `HTTP ${e.response?.status}` : String(e)}`)
    }
  }

  return { conversas, erros }
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
