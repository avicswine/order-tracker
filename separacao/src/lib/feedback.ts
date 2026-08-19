// Feedback físico para o operador no galpão: som, vibração e voz.
// Tudo tolerante a navegador sem suporte (não quebra nada).

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tom(freq: number, duracaoMs: number, inicioMs = 0, tipo: OscillatorType = 'sine', volume = 0.4) {
  const c = audio()
  if (!c) return
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = tipo
  osc.frequency.value = freq
  gain.gain.value = volume
  osc.connect(gain).connect(c.destination)
  const t0 = c.currentTime + inicioMs / 1000
  osc.start(t0)
  osc.stop(t0 + duracaoMs / 1000)
}

export function somOk() {
  tom(880, 90)
  tom(1320, 140, 100)
}

export function somErro() {
  tom(220, 220, 0, 'square', 0.5)
  tom(180, 260, 240, 'square', 0.5)
}

export function somConcluido() {
  tom(660, 100); tom(880, 100, 110); tom(1100, 100, 220); tom(1320, 260, 330)
}

export function vibrar(padrao: number | number[]) {
  try { navigator.vibrate?.(padrao) } catch { /* sem suporte */ }
}

let vozAtiva = true
export function setVozAtiva(v: boolean) { vozAtiva = v }
export function getVozAtiva() { return vozAtiva }

export function falar(texto: string) {
  if (!vozAtiva) return
  try {
    const synth = window.speechSynthesis
    if (!synth) return
    synth.cancel()
    const u = new SpeechSynthesisUtterance(texto)
    u.lang = 'pt-BR'
    u.rate = 1.05
    synth.speak(u)
  } catch { /* sem suporte */ }
}

// Chamar num toque do usuário para "destravar" áudio/voz no celular
export function destravarAudio() {
  audio()
  try { window.speechSynthesis?.getVoices() } catch { /* ignora */ }
}

export function feedbackOk(texto?: string) { somOk(); vibrar(120); if (texto) falar(texto) }
export function feedbackErro(texto?: string) { somErro(); vibrar([150, 80, 150, 80, 300]); if (texto) falar(texto) }
export function feedbackConcluido(texto?: string) { somConcluido(); vibrar([100, 50, 100, 50, 400]); if (texto) falar(texto) }
