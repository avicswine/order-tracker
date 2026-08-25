import axios from 'axios'
import { prisma } from '../lib/prisma'
import { PendenciaOrigem, PendenciaTipo } from '@prisma/client'

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
        const jaExiste = await prisma.pendencia.findUnique({ where: { mlClaimId: claimId } })
        if (jaExiste) continue

        // Enriquece com dados da venda (comprador + item) — best-effort
        let comprador = 'Cliente Mercado Livre'
        let item = ''
        if (claim.resource === 'order' && claim.resource_id) {
          try {
            const { data: order } = await axios.get(
              `https://api.mercadolibre.com/orders/${claim.resource_id}`,
              { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 }
            )
            const buyer = order?.buyer
            comprador = [buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') || buyer?.nickname || comprador
            item = order?.order_items?.[0]?.item?.title ?? ''
          } catch { /* segue sem enriquecer */ }
        }

        await prisma.pendencia.create({
          data: {
            customerName: comprador,
            senderCnpj: COMPANY_CNPJ[company],
            tipo: PendenciaTipo.RECLAMACAO_ML,
            origem: PendenciaOrigem.MERCADO_LIVRE,
            mlClaimId: claimId,
            mlOrderId: claim.resource_id ? String(claim.resource_id) : null,
            descricao: [
              item && `Item: ${item}`,
              claim.reason_id && `Motivo: ${claim.reason_id}`,
              `Etapa: ${claim.stage} | Aberta em ${new Date(claim.date_created).toLocaleDateString('pt-BR')}`,
            ].filter(Boolean).join('\n'),
          },
        })
        criadas++
        console.log(`[ML] Reclamação ${claimId} (${company.toUpperCase()}) → pendência criada`)
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
