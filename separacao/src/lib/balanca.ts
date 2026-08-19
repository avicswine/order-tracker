import { useCallback, useEffect, useRef, useState } from 'react'

// Leitura de balança pela porta serial direto do navegador (Web Serial API — Chrome/Edge no PC).
// Preparado para a fase 4b: quando a balança chegar, ajustar BAUD_PADRAO e, se preciso, o parser.
// A maioria das balanças (Toledo, Filizola, Urano...) envia linhas de texto com o peso, ex.:
//   "  1.234 kg", "ST,GS,+0001.234kg", "P: 001.234"  → o parser pega o primeiro número decimal.

const BAUD_PADRAO = 9600
const TIMEOUT_LEITURA_MS = 3000

interface SerialPortLike {
  open(opts: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>
}

export function webSerialDisponivel(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator
}

export function parsearPeso(texto: string): number | null {
  const m = texto.replace(',', '.').match(/[-+]?\d+\.\d+|[-+]?\d+/)
  if (!m) return null
  const v = parseFloat(m[0])
  return Number.isFinite(v) ? Math.abs(v) : null
}

export function useBalanca(baudRate = BAUD_PADRAO) {
  const [conectada, setConectada] = useState(false)
  const [peso, setPeso] = useState<number | null>(null)
  const [erro, setErro] = useState('')
  const [ultimaLeitura, setUltimaLeitura] = useState<number>(0)
  const portRef = useRef<SerialPortLike | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const pararRef = useRef(false)

  const desconectar = useCallback(async () => {
    pararRef.current = true
    try { await readerRef.current?.cancel() } catch { /* ignora */ }
    try { await portRef.current?.close() } catch { /* ignora */ }
    readerRef.current = null
    portRef.current = null
    setConectada(false)
  }, [])

  const conectar = useCallback(async () => {
    setErro('')
    if (!webSerialDisponivel()) {
      setErro('Este navegador não suporta Web Serial. Use o Chrome ou Edge no PC.')
      return
    }
    try {
      const serial = (navigator as unknown as { serial: SerialLike }).serial
      const port = await serial.requestPort()
      await port.open({ baudRate })
      portRef.current = port
      pararRef.current = false
      setConectada(true)

      const decoder = new TextDecoder()
      let buffer = ''
      const reader = port.readable!.getReader()
      readerRef.current = reader
      ;(async () => {
        try {
          while (!pararRef.current) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const linhas = buffer.split(/[\r\n]+/)
            buffer = linhas.pop() ?? ''
            for (const linha of linhas) {
              const p = parsearPeso(linha)
              if (p !== null) { setPeso(p); setUltimaLeitura(Date.now()) }
            }
            // Balanças que não mandam quebra de linha: tenta o buffer inteiro
            if (buffer.length > 40) { const p = parsearPeso(buffer); if (p !== null) { setPeso(p); setUltimaLeitura(Date.now()) } buffer = '' }
          }
        } catch (e) {
          if (!pararRef.current) setErro('Leitura interrompida: ' + (e instanceof Error ? e.message : String(e)))
        } finally {
          reader.releaseLock()
          setConectada(false)
        }
      })()
    } catch (e) {
      setErro('Não foi possível conectar: ' + (e instanceof Error ? e.message : String(e)))
      setConectada(false)
    }
  }, [baudRate])

  useEffect(() => () => { desconectar() }, [desconectar])

  const pesoRecente = peso !== null && Date.now() - ultimaLeitura < TIMEOUT_LEITURA_MS ? peso : null
  return { conectar, desconectar, conectada, peso, pesoRecente, erro, disponivel: webSerialDisponivel() }
}
