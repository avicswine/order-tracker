import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

// Leitor de QR Code / código de barras pela câmera.
// - Chrome Android: API nativa BarcodeDetector (rápida, lê QR e códigos de barras).
// - iPhone/Safari e outros: fallback com jsQR (só QR Code, decodificado em JavaScript).
// Exige HTTPS (ou localhost). O campo de digitação/leitor Bluetooth continua funcionando sempre.

interface DetectorLike {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>
}
type DetectorCtor = new (opts: { formats: string[] }) => DetectorLike

const INTERVALO_MESMO_CODIGO_MS = 2500
const FORMATOS = ['qr_code', 'code_128', 'ean_13', 'ean_8', 'code_39', 'data_matrix']
const JSQR_INTERVALO_MS = 120     // ~8 leituras/s no fallback (poupa bateria)
const JSQR_LARGURA_MAX = 480      // reduz o frame antes de decodificar

export default function ScannerQr({ onCodigo, ativo }: { onCodigo: (codigo: string) => void; ativo: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [erro, setErro] = useState('')
  const [modo, setModo] = useState<'nativo' | 'jsqr' | null>(null)
  const ultimoRef = useRef<{ valor: string; em: number }>({ valor: '', em: 0 })
  const cbRef = useRef(onCodigo)
  cbRef.current = onCodigo

  useEffect(() => {
    if (!ativo) return
    let parado = false
    let stream: MediaStream | null = null
    let raf = 0
    let timer = 0

    if (!window.isSecureContext) {
      setErro('A câmera só funciona em HTTPS. Abra o app pelo endereço seguro.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setErro('Este navegador não dá acesso à câmera. Digite ou bipe o código no campo.')
      return
    }

    const entregar = (valor: string | undefined) => {
      const v = valor?.trim()
      if (!v) return
      const agora = Date.now()
      const ultimo = ultimoRef.current
      if (v !== ultimo.valor || agora - ultimo.em > INTERVALO_MESMO_CODIGO_MS) {
        ultimoRef.current = { valor: v, em: agora }
        cbRef.current(v)
      }
    }

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (parado) { stream.getTracks().forEach(t => t.stop()); return }
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        setErro('')

        const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
        if (Detector) {
          setModo('nativo')
          const detector = new Detector({ formats: FORMATOS })
          const loop = async () => {
            if (parado) return
            try {
              if (video.readyState >= 2) {
                const codigos = await detector.detect(video)
                if (codigos.length > 0) entregar(codigos[0].rawValue)
              }
            } catch { /* falha pontual de detecção */ }
            raf = requestAnimationFrame(loop)
          }
          raf = requestAnimationFrame(loop)
          return
        }

        // Fallback jsQR (iPhone/Safari)
        setModo('jsqr')
        const canvas = canvasRef.current ?? document.createElement('canvas')
        canvasRef.current = canvas
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) { setErro('Não foi possível iniciar o leitor.'); return }
        const tick = () => {
          if (parado) return
          try {
            if (video.readyState >= 2 && video.videoWidth > 0) {
              const escala = Math.min(1, JSQR_LARGURA_MAX / video.videoWidth)
              canvas.width = Math.round(video.videoWidth * escala)
              canvas.height = Math.round(video.videoHeight * escala)
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
              const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
              if (qr?.data) entregar(qr.data)
            }
          } catch { /* falha pontual */ }
          timer = window.setTimeout(tick, JSQR_INTERVALO_MS)
        }
        tick()
      } catch (e) {
        setErro('Não foi possível acessar a câmera: ' + (e instanceof Error ? e.message : String(e)))
      }
    })()

    return () => {
      parado = true
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [ativo])

  if (!ativo) return null
  return (
    <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3] max-h-64 w-full">
      <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
      {!erro && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-3/5 aspect-square border-4 border-white/70 rounded-2xl" />
        </div>
      )}
      {modo === 'jsqr' && !erro && (
        <div className="absolute bottom-1 right-2 text-[10px] text-white/70 pointer-events-none">leitor JS · só QR Code</div>
      )}
      {erro && <div className="absolute inset-0 bg-black/80 text-amber-300 text-sm p-4 flex items-center text-center">{erro}</div>}
    </div>
  )
}
