import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../../lib/prisma'
import type { OperadorPayload } from '../../middleware/requireOperador'

const PIN_REGEX = /^\d{4,8}$/
const BCRYPT_ROUNDS = 10        // PIN curto: custo menor que a senha do painel (12) para não travar o celular
const TOKEN_VALIDADE = '14h'    // um turno de trabalho com folga

export const OPERADOR_PUBLICO = {
  id: true, nome: true, supervisor: true, ativo: true, createdAt: true,
} as const

export function pinValido(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_REGEX.test(pin)
}

export function nomeValido(nome: unknown): nome is string {
  return typeof nome === 'string' && nome.trim().length >= 2 && nome.trim().length <= 40
}

export async function totalOperadores(): Promise<number> {
  return prisma.separacaoOperador.count()
}

export async function criarOperador(dados: { nome: string; pin: string; supervisor: boolean }) {
  const nome = dados.nome.trim()
  const existente = await prisma.separacaoOperador.findFirst({ where: { nome: { equals: nome, mode: 'insensitive' } } })
  if (existente) throw new Error('Já existe um operador com esse nome')

  const pinHash = await bcrypt.hash(dados.pin, BCRYPT_ROUNDS)
  return prisma.separacaoOperador.create({
    data: { nome, pinHash, supervisor: dados.supervisor },
    select: OPERADOR_PUBLICO,
  })
}

export async function atualizarOperador(id: string, dados: { pin?: string; supervisor?: boolean; ativo?: boolean; nome?: string }) {
  const data: Record<string, unknown> = {}
  if (dados.nome !== undefined) data.nome = dados.nome.trim()
  if (dados.supervisor !== undefined) data.supervisor = dados.supervisor
  if (dados.ativo !== undefined) data.ativo = dados.ativo
  if (dados.pin !== undefined) data.pinHash = await bcrypt.hash(dados.pin, BCRYPT_ROUNDS)
  return prisma.separacaoOperador.update({ where: { id }, data, select: OPERADOR_PUBLICO })
}

export async function autenticarOperador(nome: string, pin: string): Promise<{ token: string; operador: OperadorPayload } | null> {
  const operador = await prisma.separacaoOperador.findFirst({
    where: { nome: { equals: nome.trim(), mode: 'insensitive' }, ativo: true },
  })
  if (!operador) return null

  const ok = await bcrypt.compare(pin, operador.pinHash)
  if (!ok) return null

  const payload: OperadorPayload = { kind: 'operador', id: operador.id, nome: operador.nome, supervisor: operador.supervisor }
  const token = jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: TOKEN_VALIDADE })
  return { token, operador: payload }
}
