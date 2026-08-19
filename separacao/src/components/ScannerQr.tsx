import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

// Leitor de QR Code / código de barras pela câmera.
// - Chrome Android: API nativa BarcodeDetector (rápida; QR e códigos 1D).
// - iPhone/Safari e outros: fallback ZXing em JavaScript (QR e códigos 1D — ex.: Code128 da DANFE).
// Exige HTTPS (ou localhost). O campo de digitação/leitor Bluetooth continua funcionando sempre.

interface DetectorLike {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>
}
type DetectorCtor = new (opts: { formats: string[] }) => DetectorLike

const INTERVALO_MESMO_CODIGO_MS = 2500
const FORMATOS_NATIVO = ['qr_code', 'code_128', 'ean_13', 'ean_8', 'code_39', 'itf', 'data_matrix']
const FORMATOS_ZXING = [
  BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_39, BarcodeFormat.ITF, BarcodeFormat.DATA_MATRIX,
]
const ZXING_INTERVALO_MS = 150 // tempo entre tentativas de decodificação (poupa bateria)

export default function ScannerQr({ onCodigo, ativo }: { onCodigo: (codigo: string) => void; ativo: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [erro, setErro] = useState('')
  const [modo, setModo] = useState<'nativo' | 'zxing' | null>(null)
  const ultimoRef = useRef<{ valor: string; em: number }>({ valor: '', em: 0 })
  const cbRef = useRef(onCodigo)
  cbRef.current = onCodigo

  useEffect(() => {
    if (!ativo) return
    let parado = false
    let stream: MediaStream | null = null
    let raf = 0
    let controles: IScannerControls | null = null

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
        const video = videoRef.current!
        const Detector = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector

        if (Detector) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          if (parado) { stream.getTracks().forEach(t => t.stop()); return }
          video.srcObject = stream
          await video.play()
          setErro('')
          setModo('nativo')
          const detector = new Detector({ formats: FORMATOS_NATIVO })
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

        // Fallback ZXing (iPhone/Safari): lê QR e códigos de barras 1D
        setModo('zxing')
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATOS_ZXING)
        hints.set(DecodeHintType.TRY_HARDER, true)
        const leitor = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: ZXING_INTERVALO_MS })
        controles = await leitor.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          video,
          (resultado) => { if (resultado) entregar(resultado.getText()) },
        )
        if (parado) { controles.stop(); return }
        setErro('')
      } catch (e) {
        setErro('Não foi possível acessar a câmera: ' + (e instanceof Error ? e.message : String(e)))
      }
    })()

    return () => {
      parado = true
      cancelAnimationFrame(raf)
      controles?.stop()
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [ativo])

  if (!ativo) return null
  return (
    <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3] max-h-64 w-full">
      <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
      {!erro && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-4/5 h-3/5 border-4 border-white/70 rounded-2xl" />
        </div>
      )}
      {modo === 'zxing' && !erro && (
        <div className="absolute bottom-1 right-2 text-[10px] text-white/70 pointer-events-none">leitor JS · QR e código de barras</div>
      )}
      {erro && <div className="absolute inset-0 bg-black/80 text-amber-300 text-sm p-4 flex items-center text-center">{erro}</div>}
    </div>
  )
}
