import { useRef, useState } from 'react'
import { api } from '../lib/api'
import type { TarefaResumo } from '../types'

// Plano B quando a câmera não decodifica o código de barras da DANFE (Code128 de 44 dígitos):
// o operador tira uma foto da etiqueta e o servidor lê os números impressos (OCR).
// Usa <input capture> — abre a câmera nativa do celular, que tem foco e resolução melhores que o vídeo ao vivo.

interface Props {
  empresa?: string
  onEncontrou: (tarefas: TarefaResumo[], leitura: { chave: string | null; numero: string | null }) => void
  onErro: (mensagem: string) => void
}

const LARGURA_MAX = 1600 // reduz antes de enviar (a etiqueta é legível bem antes do tamanho original)

async function comprimir(arquivo: File): Promise<string> {
  const bitmap = await createImageBitmap(arquivo)
  const escala = Math.min(1, LARGURA_MAX / bitmap.width)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', 0.85)
}

export default function FotoDanfe({ empresa, onEncontrou, onErro }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [lendo, setLendo] = useState(false)

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = '' // permite fotografar de novo o mesmo arquivo
    if (!arquivo) return
    setLendo(true)
    try {
      const imagem = await comprimir(arquivo)
      const r = await api.post<{ tarefas: TarefaResumo[]; leitura: { chave: string | null; numero: string | null } }>(
        '/tarefas/ler-danfe', { imagem, empresa })
      if (r.tarefas.length === 0) {
        onErro(`Li a nota ${r.leitura.numero ?? r.leitura.chave?.slice(-9) ?? ''}, mas ela não está na fila de separação.`)
        return
      }
      onEncontrou(r.tarefas, r.leitura)
    } catch (err) {
      onErro(err instanceof Error ? err.message : 'Não consegui ler a foto')
    } finally {
      setLendo(false)
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={aoEscolher} />
      <button type="button" className="btn-secondary w-full !py-2 text-sm" disabled={lendo} onClick={() => inputRef.current?.click()}>
        {lendo ? 'Lendo a foto…' : '📸 Fotografar a etiqueta da nota'}
      </button>
    </>
  )
}
