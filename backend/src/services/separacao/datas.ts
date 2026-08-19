// Datas no fuso da operação (Brasília). O servidor no Railway roda em UTC — sem isso,
// "hoje" viraria "amanhã" às 21h e a fila do dia sumiria à noite.
export const FUSO_OPERACAO = 'America/Sao_Paulo'
const OFFSET_BR = '-03:00' // Brasil não tem mais horário de verão

// 'YYYY-MM-DD' de hoje (ou de um instante) em Brasília
export function dataBR(instante: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_OPERACAO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante)
}

// Soma dias a uma data 'YYYY-MM-DD'
export function somarDias(dataISO: string, dias: number): string {
  const d = new Date(`${dataISO}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

// Instante da meia-noite (Brasília) de uma data 'YYYY-MM-DD'
export function meiaNoiteBR(dataISO: string): Date {
  return new Date(`${dataISO}T00:00:00${OFFSET_BR}`)
}

// Datas do Bling vêm sem fuso ("2026-08-18 14:03:00") e são horário local da empresa (BR)
export function parseDataBling(v?: string | null): Date | undefined {
  if (!v) return undefined
  const texto = v.trim().replace(' ', 'T')
  const temFuso = /(Z|[+-]\d{2}:\d{2})$/.test(texto)
  const iso = texto.length === 10 ? `${texto}T00:00:00${OFFSET_BR}` : temFuso ? texto : `${texto}${OFFSET_BR}`
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? undefined : d
}
