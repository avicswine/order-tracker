import { useCallback, useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

// Leitor de QR Code / código de barras pela câmera.
// - Chrome Android: API nativa BarcodeDetector.
// - iPhone/Safari e outros: ZXing em JavaScript.
// A chave da DANFE é um Code128 de 44 dígitos (barras finas): por isso pedimos a maior resolução
// possível, deixamos ligar a lanterna e dar zoom — sem isso a câmera não resolve as barras.

interface DetectorLike {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>
}
type DetectorCtor = new (opts: { formats: string[] }) => DetectorLike

const INTERVALO_MESMO_CODIGO_MS = 2500
const FORMATOS_NATIVO = ['qr_code', 'code_128', 'ean_13', 'code_39', 'itf']
const FORMATOS_ZXING = [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.CODE_39, BarcodeFormat.ITF]
const ZXING_INTERVALO_MS = 100

// Resolução alta é o que permite ler a chave da DANFE; o navegador entrega o máximo que a câmera suportar
const RESTRICOES_VIDEO: MediaTrackConstraints = {
  facingMode: { ideal: 'environment' },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  // @ts-expect-error focusMode não está na tipagem padrão, mas é aceito por Chrome/Safari
  focusMode: 'continuous',
}

type Capacidades = MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number; step: number } }

export default function ScannerQr({ onCodigo, ativo, modoCodigoBarras = false }: {
  onCodigo: (codigo: string) => void
  ativo: boolean
  modoCodigoBarras?: boolean // mira horizontal + dicas para a chave da DANFE
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [erro, setErro] = useState('')
  const [modo, setModo] = useState<'nativo' | 'zxing' | null>(null)
  const [temLanterna, setTemLanterna] = useState(false)
  const [lanterna, setLanterna] = useState(false)
  const [zoomMax, setZoomMax] = useState(0)
  const [zoom, setZoom] = useState(1)
  const ultimoRef = useRef<{ valor: string; em: number }>({ valor: '', em: 0 })
  const cbRef = useRef(onCodigo)
  cbRef.current = onCodigo

  // Guarda a track para controlar lanterna/zoom
  const registrarTrack = useCallback((stream: MediaStream) => {
    const track = stream.getVideoTracks()[0]
    trackRef.current = track
    const caps = (track.getCapabilities?.() ?? {}) as Capacidades
    setTemLanterna(!!caps.torch)
    if (caps.zoom) {
      setZoomMax(caps.zoom.max)
      setZoom(track.getSettings().zoom as number ?? caps.zoom.min ?? 1)
    }
  }, [])

  async function alternarLanterna() {
    const track = trackRef.current
    if (!track) return
    const novo = !lanterna
    try {
      await track.applyConstraints({ advanced: [{ torch: novo } as MediaTrackConstraintSet] })
      setLanterna(novo)
    } catch { /* sem suporte */ }
  }

  async function aplicarZoom(valor: number) {
    const track = trackRef.current
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ zoom: valor } as MediaTrackConstraintSet] })
      setZoom(valor)
    } catch { /* sem suporte */ }
  }

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
          stream = await navigator.mediaDevices.getUserMedia({ video: RESTRICOES_VIDEO })
          if (parado) { stream.getTracks().forEach(t => t.stop()); return }
          video.srcObject = stream
          await video.play()
          registrarTrack(stream)
          setErro(''); setModo('nativo')
          const detector = new Detector({ formats: FORMATOS_NATIVO })
          const loop = async () => {
            if (parado) return
            try {
              if (video.readyState >= 2) {
                const codigos = await detector.detect(video)
                if (codigos.length > 0) entregar(codigos[0].rawValue)
              }
            } catch { /* falha pontual */ }
            raf = requestAnimationFrame(loop)
          }
          raf = requestAnimationFrame(loop)
          return
        }

        // Fallback ZXing (iPhone/Safari)
        setModo('zxing')
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATOS_ZXING)
        hints.set(DecodeHintType.TRY_HARDER, true)
        const leitor = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: ZXING_INTERVALO_MS })
        controles = await leitor.decodeFromConstraints(
          { video: RESTRICOES_VIDEO },
          video,
          (resultado) => { if (resultado) entregar(resultado.getText()) },
        )
        if (parado) { controles.stop(); return }
        if (video.srcObject instanceof MediaStream) registrarTrack(video.srcObject)
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
      trackRef.current = null
    }
  }, [ativo, registrarTrack])

  if (!ativo) return null
  return (
    <div>
      <div className={`relative rounded-2xl overflow-hidden bg-black w-full ${modoCodigoBarras ? 'aspect-[3/2] max-h-72' : 'aspect-[4/3] max-h-64'}`}>
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        {!erro && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* Mira larga e baixa para código de barras; quadrada para QR */}
            <div className={`border-4 border-white/70 rounded-xl ${modoCodigoBarras ? 'w-[92%] h-1/4' : 'w-3/5 aspect-square'}`} />
          </div>
        )}
        {temLanterna && !erro && (
          <button
            onClick={alternarLanterna}
            className={`absolute top-2 right-2 rounded-full px-3 py-1.5 text-sm font-medium ${lanterna ? 'bg-yellow-300 text-yellow-900' : 'bg-black/60 text-white'}`}
          >
            {lanterna ? '🔦 Ligada' : '🔦 Luz'}
          </button>
        )}
        {erro && <div className="absolute inset-0 bg-black/80 text-amber-300 text-sm p-4 flex items-center text-center">{erro}</div>}
      </div>

      {zoomMax > 1 && !erro && (
        <div className="flex items-center gap-2 mt-1 text-xs text-slate-600">
          <span>Zoom</span>
          <input type="range" className="flex-1" min={1} max={zoomMax} step={0.1} value={zoom} onChange={e => aplicarZoom(Number(e.target.value))} />
          <span className="w-8 text-right">{zoom.toFixed(1)}x</span>
        </div>
      )}

      {modoCodigoBarras && !erro && (
        <p className="text-xs text-slate-500 mt-1">
          Chave da DANFE: encoste a mira no código de barras (uns 10–15 cm), preencha a largura toda e segure firme.
          Se não ler, use o zoom, ligue a luz — ou digite o nº da NF no campo acima.
        </p>
      )}
      {modo === 'zxing' && !erro && <div className="text-[10px] text-slate-400 mt-0.5">leitor JS (Safari) · QR e código de barras</div>}
    </div>
  )
}
