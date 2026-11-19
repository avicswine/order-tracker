import fs from 'fs'
import path from 'path'
import axios from 'axios'
import { PrismaClient } from '@prisma/client'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const prisma = new PrismaClient()

const BLING_API = 'https://api.bling.com.br/Api/v3'
const BLING_TOKEN_URL = 'https://api.bling.com.br/Api/v3/oauth/token'
const TOKENS_FILE = path.join(__dirname, '../../.bling-tokens.json')

const COMPANIES: Record<string, { name: string; cnpj: string; clientId: string; clientSecret: string }> = {
  avic:       { name: 'Avic',       cnpj: '47.715.256/0001-49', clientId: process.env.BLING_AVIC_CLIENT_ID!,       clientSecret: process.env.BLING_AVIC_CLIENT_SECRET! },
  agrogranja: { name: 'Agrogranja', cnpj: '54.695.386/0001-22', clientId: process.env.BLING_AGROGRANJA_CLIENT_ID!, clientSecret: process.env.BLING_AGROGRANJA_CLIENT_SECRET! },
  equipage:   { name: 'Equipage',   cnpj: '56.633.474/0001-25', clientId: process.env.BLING_EQUIPAGE_CLIENT_ID!,   clientSecret: process.env.BLING_EQUIPAGE_CLIENT_SECRET! },
}

const tokens: Record<string, { access_token: string; refresh_token: string }> = (() => {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8')) } catch { return {} }
})()

function saveTokens() {
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2))
}

async function refreshToken(key: string) {
  const c = COMPANIES[key]
  const creds = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')
  const r = await axios.post(BLING_TOKEN_URL, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens[key].refresh_token }), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` },
  })
  tokens[key] = { access_token: r.data.access_token, refresh_token: r.data.refresh_token }
  saveTokens()
}

async function blingGet(key: string, endpoint: string): Promise<unknown> {
  try {
    const r = await axios.get(`${BLING_API}${endpoint}`, { headers: { Authorization: `Bearer ${tokens[key].access_token}` } })
    return r.data
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      await refreshToken(key)
      const r = await axios.get(`${BLING_API}${endpoint}`, { headers: { Authorization: `Bearer ${tokens[key].access_token}` } })
      return r.data
    }
    if (axios.isAxiosError(err) && err.response?.status === 429) {
      await new Promise(r => setTimeout(r, 2000))
      return blingGet(key, endpoint)
    }
    throw err
  }
}

async function main() {
  const connected = Object.keys(COMPANIES).filter(k => !!tokens[k])
  console.log('Empresas conectadas:', connected.join(', '))

  const orders = await prisma.order.findMany({
    where: { recipientCnpj: null, nfNumber: { not: null } },
    select: { id: true, nfNumber: true, senderCnpj: true },
  })
  console.log(`Pedidos sem recipientCnpj: ${orders.length}`)
  if (orders.length === 0) { await prisma.$disconnect(); return }

  const needed = new Set(orders.map(o => String(parseInt(o.nfNumber!, 10))))
  const cnpjMap: Record<string, string> = {}

  const dataInicio = new Date()
  dataInicio.setDate(dataInicio.getDate() - 365)
  const dataInicioStr = dataInicio.toISOString().slice(0, 10)

  for (const key of connected) {
    const company = COMPANIES[key]
    let pagina = 1
    while (true) {
      const data = await blingGet(key, `/nfe?pagina=${pagina}&limite=100&dataEmissaoInicial=${dataInicioStr}`) as { data?: { numero: number; destinatario?: { numeroDocumento?: string } }[] }
      const nfes = data?.data ?? []
      if (nfes.length === 0) break
      for (const nf of nfes) {
        const num = String(parseInt(String(nf.numero), 10))
        const doc = nf.contato?.numeroDocumento?.replace(/\D/g, '')
        if (needed.has(num) && doc) cnpjMap[`${num}|${company.cnpj.replace(/\D/g, '')}`] = doc
      }
      console.log(`${company.name} pág ${pagina}: ${nfes.length} NFs`)
      if (nfes.length < 100) break
      pagina++
      await new Promise(r => setTimeout(r, 300))
    }
  }

  console.log(`\nCNPJs encontrados: ${Object.keys(cnpjMap).length}`)

  let atualizados = 0
  let semDados = 0
  for (const order of orders) {
    const senderDigits = order.senderCnpj?.replace(/\D/g, '') ?? ''
    const key = `${String(parseInt(order.nfNumber!, 10))}|${senderDigits}`
    const doc = cnpjMap[key]
    if (!doc) { semDados++; continue }
    await prisma.order.update({ where: { id: order.id }, data: { recipientCnpj: doc } })
    atualizados++
  }

  console.log(`\nConcluído: ${atualizados} atualizados | ${semDados} sem dados`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
