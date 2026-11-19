import { PrismaClient } from '@prisma/client'
import { runBlingSync } from '../routes/bling'

// Estratégia: o sync do Bling já atualiza customerPhone nos pedidos existentes.
// Para email, fazemos o mesmo: buscamos a listagem paginada do Bling e
// atualizamos o customerEmail nos pedidos que ainda não têm.

import axios from 'axios'
import fs from 'fs'
import path from 'path'

const prisma = new PrismaClient()
const TOKENS_FILE = path.join(__dirname, '../../.bling-tokens.json')
const BLING_API = 'https://api.bling.com.br/Api/v3'

const COMPANIES: Record<string, { name: string; cnpj: string; clientId: string; clientSecret: string }> = {
  avic:      { name: 'Avic',      cnpj: '47.715.256/0001-49', clientId: process.env.BLING_AVIC_CLIENT_ID!,      clientSecret: process.env.BLING_AVIC_CLIENT_SECRET! },
  agrogranja:{ name: 'Agrogranja',cnpj: '54.695.386/0001-22', clientId: process.env.BLING_AGROGRANJA_CLIENT_ID!,clientSecret: process.env.BLING_AGROGRANJA_CLIENT_SECRET! },
  equipage:  { name: 'Equipage',  cnpj: '56.633.474/0001-25', clientId: process.env.BLING_EQUIPAGE_CLIENT_ID!,  clientSecret: process.env.BLING_EQUIPAGE_CLIENT_SECRET! },
}

function loadTokens(): Record<string, { access_token: string; refresh_token: string }> {
  try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8')) } catch { return {} }
}

async function blingGet(token: string, endpoint: string): Promise<unknown> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    try {
      const res = await axios.get(`${BLING_API}${endpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      return res.data
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 429) {
        const espera = 2000 * (tentativa + 1)
        console.log(`Rate limit (429) — aguardando ${espera / 1000}s...`)
        await new Promise(r => setTimeout(r, espera))
        continue
      }
      throw err
    }
  }
  throw new Error('Máximo de tentativas atingido (429)')
}

async function main() {
  const tokens = loadTokens()
  const connected = Object.keys(COMPANIES).filter(k => !!tokens[k])

  if (connected.length === 0) {
    console.log('Nenhuma empresa conectada ao Bling.')
    await prisma.$disconnect()
    return
  }

  // Pedidos sem email
  const semEmail = await prisma.order.findMany({
    where: { customerEmail: null, nfNumber: { not: null } },
    select: { id: true, nfNumber: true, senderCnpj: true, orderNumber: true },
  })

  console.log(`Pedidos sem email: ${semEmail.length}`)
  if (semEmail.length === 0) {
    await prisma.$disconnect()
    return
  }

  // Monta set de NFs necessárias por empresa (senderCnpj → nfNumber)
  const nfsPorEmpresa: Record<string, Set<string>> = {}
  for (const order of semEmail) {
    const key = connected.find(k => COMPANIES[k].cnpj === order.senderCnpj)
    if (!key) continue
    if (!nfsPorEmpresa[key]) nfsPorEmpresa[key] = new Set()
    nfsPorEmpresa[key].add(String(parseInt(order.nfNumber!, 10)))
  }

  // Mapa nfNumero|companyCnpj → email
  const emailMap: Record<string, string> = {}

  const dataInicio = new Date()
  dataInicio.setDate(dataInicio.getDate() - 365)
  const dataInicioStr = dataInicio.toISOString().slice(0, 10)

  for (const companyKey of connected) {
    const nfsNecessarias = nfsPorEmpresa[companyKey]
    if (!nfsNecessarias || nfsNecessarias.size === 0) continue

    const company = COMPANIES[companyKey]
    const token = tokens[companyKey].access_token
    let pagina = 1
    let encontrados = 0

    console.log(`\nBuscando NFs da ${company.name}...`)

    while (true) {
      const data = await blingGet(token, `/nfe?pagina=${pagina}&limite=100&dataEmissaoInicial=${dataInicioStr}`) as { data?: { numero: number; contato?: { email?: string } }[] }
      const nfes = data?.data ?? []
      if (nfes.length === 0) break

      for (const nf of nfes) {
        const numStr = String(parseInt(String(nf.numero), 10))
        if (nfsNecessarias.has(numStr) && nf.contato?.email) {
          emailMap[`${numStr}|${company.cnpj}`] = nf.contato.email
          encontrados++
        }
      }

      if (nfes.length < 100) break
      pagina++
      await new Promise(r => setTimeout(r, 1000))
    }

    console.log(`${company.name}: ${encontrados} emails encontrados`)
  }

  // Atualiza os pedidos
  let atualizados = 0
  let semDados = 0

  for (const order of semEmail) {
    const nfNum = String(parseInt(order.nfNumber!, 10))
    const email = emailMap[`${nfNum}|${order.senderCnpj}`]

    if (!email) { semDados++; continue }

    await prisma.order.update({ where: { id: order.id }, data: { customerEmail: email } })
    console.log(`${order.orderNumber}: ${email}`)
    atualizados++
  }

  console.log(`\n=== Concluído ===`)
  console.log(`Atualizados: ${atualizados} | Sem dados: ${semDados}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
