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

// O QR Code da DANFE não é a chave pura: vem como URL (…?p=chave|versão|…) ou campos separados
// por "|" (ex.: "A|3086…422|4|0|…"). Detecta esses formatos para não tratar como SKU errado.
export function extrairChaveDeQrDanfe(entrada: string): string | null {
  const texto = (entrada || '').trim()
  if (!texto) return null
  if (parsearChaveDanfe(texto)) return texto.replace(/\D/g, '')
  const pareceQrDanfe = texto.includes('|') || /^https?:\/\//i.test(texto)
  if (!pareceQrDanfe) return null
  const chave = texto.match(/\d{44}/)
  return chave ? chave[0] : null
}

// Códigos que claramente não são SKU de produto (DANFE bipada por engano na tela de separação)
export function pareceCodigoDeNota(entrada: string): boolean {
  return extrairChaveDeQrDanfe(entrada) !== null
}
