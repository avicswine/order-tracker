import { prisma } from '../../lib/prisma'

// Configurações do módulo de separação (tabela separacao_config, valor em JSON).
// Tudo o que não estiver salvo cai no padrão abaixo.
export const CONFIG_PADRAO = {
  limiteBipeUnitario: 5,   // até esta qtd o operador bipa unidade a unidade; acima, 1 bipe + digita a qtd
  intervaloSyncMin: 3,     // minutos entre buscas de NFs novas no Bling
  diasNfsFila: 1,          // quantos dias para trás buscar NFs (1 = só hoje)
  toleranciaPesoPct: 5,    // conferência de peso no balcão (fase 4b)
  balancaAtiva: false,     // liga a etapa de pesagem no balcão (aguarda balança)
}

export type SeparacaoConfigValores = typeof CONFIG_PADRAO
export type SeparacaoConfigChave = keyof SeparacaoConfigValores

export async function getConfig(): Promise<SeparacaoConfigValores> {
  const linhas = await prisma.separacaoConfig.findMany()
  const resultado: SeparacaoConfigValores = { ...CONFIG_PADRAO }
  for (const linha of linhas) {
    if (!(linha.chave in CONFIG_PADRAO)) continue
    try {
      ;(resultado as Record<string, unknown>)[linha.chave] = JSON.parse(linha.valor)
    } catch {
      // valor corrompido → mantém o padrão
    }
  }
  return resultado
}

export async function setConfig(parcial: Partial<SeparacaoConfigValores>): Promise<SeparacaoConfigValores> {
  const chaves = Object.keys(parcial).filter((c): c is SeparacaoConfigChave => c in CONFIG_PADRAO)
  await prisma.$transaction(
    chaves.map(chave =>
      prisma.separacaoConfig.upsert({
        where: { chave },
        update: { valor: JSON.stringify(parcial[chave]) },
        create: { chave, valor: JSON.stringify(parcial[chave]) },
      })
    )
  )
  return getConfig()
}

// Valida tipos/limites antes de salvar (entrada vem do front)
export function validarConfig(entrada: unknown): { ok: true; valores: Partial<SeparacaoConfigValores> } | { ok: false; erro: string } {
  if (!entrada || typeof entrada !== 'object') return { ok: false, erro: 'Corpo inválido' }
  const e = entrada as Record<string, unknown>
  const valores: Partial<SeparacaoConfigValores> = {}

  const inteiro = (chave: SeparacaoConfigChave, min: number, max: number) => {
    if (e[chave] === undefined) return true
    const v = Number(e[chave])
    if (!Number.isInteger(v) || v < min || v > max) return false
    ;(valores as Record<string, unknown>)[chave] = v
    return true
  }
  const numero = (chave: SeparacaoConfigChave, min: number, max: number) => {
    if (e[chave] === undefined) return true
    const v = Number(e[chave])
    if (!Number.isFinite(v) || v < min || v > max) return false
    ;(valores as Record<string, unknown>)[chave] = v
    return true
  }
  const booleano = (chave: SeparacaoConfigChave) => {
    if (e[chave] === undefined) return true
    if (typeof e[chave] !== 'boolean') return false
    ;(valores as Record<string, unknown>)[chave] = e[chave]
    return true
  }

  if (!inteiro('limiteBipeUnitario', 1, 1000)) return { ok: false, erro: 'limiteBipeUnitario deve ser inteiro entre 1 e 1000' }
  if (!inteiro('intervaloSyncMin', 1, 120)) return { ok: false, erro: 'intervaloSyncMin deve ser inteiro entre 1 e 120' }
  if (!inteiro('diasNfsFila', 1, 30)) return { ok: false, erro: 'diasNfsFila deve ser inteiro entre 1 e 30' }
  if (!numero('toleranciaPesoPct', 0, 100)) return { ok: false, erro: 'toleranciaPesoPct deve ser entre 0 e 100' }
  if (!booleano('balancaAtiva')) return { ok: false, erro: 'balancaAtiva deve ser true/false' }

  return { ok: true, valores }
}
