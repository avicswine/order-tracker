// Chave de acesso da NF-e (44 dígitos) — é o que o leitor de código de barras lê na DANFE.
// Layout: UF(2) AAMM(4) CNPJ(14) modelo(2) série(3) número(9) tpEmis(1) código(8) DV(1)

export interface ChaveDanfe {
  chave: string
  cnpjEmitente: string   // 14 dígitos
  serie: string          // sem zeros à esquerda
  numero: string         // sem zeros à esquerda
}

export function parsearChaveDanfe(entrada: string): ChaveDanfe | null {
  const digitos = (entrada || '').replace(/\D/g, '')
  if (digitos.length !== 44) return null
  return {
    chave: digitos,
    cnpjEmitente: digitos.slice(6, 20),
    serie: String(parseInt(digitos.slice(22, 25), 10)),
    numero: String(parseInt(digitos.slice(25, 34), 10)),
  }
}

// Normaliza um número de NF digitado/bipado: remove zeros à esquerda e espaços
export function normalizarNumeroNf(entrada: string): string {
  const digitos = (entrada || '').replace(/\D/g, '')
  return digitos ? String(parseInt(digitos, 10)) : ''
}
