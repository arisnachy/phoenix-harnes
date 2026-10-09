/** Audio envelope -> Kira's 2.5D mouth. Never plays or records audio. */
let disposeCurrent: (() => void) | undefined

/**
 * Attaches a silent analyser to the already-authorized Codex output stream.
 * Returns control immediately; a detached WebAudio graph cannot add echo.
 */
export function connectRealtimeAvatarVoiceMeter(stream: MediaStream): void {
  disconnectRealtimeAvatarVoiceMeter()
  if (typeof window === 'undefined' || typeof document === 'undefined'
    || stream.getAudioTracks().length === 0 || typeof AudioContext === 'undefined') return
  let audioContext: AudioContext
  try { audioContext = new AudioContext({ latencyHint: 'interactive' }) } catch { return }
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.58
  const samples = new Uint8Array(analyser.fftSize)
  let source: MediaStreamAudioSourceNode
  try {
    source = audioContext.createMediaStreamSource(stream)
    source.connect(analyser)
  } catch {
    void audioContext.close().catch(() => {})
    return
  }
  let active = true
  let frame: number | undefined
  let sleeping: number | undefined
  const documentRoot = document.documentElement
  const tick = () => {
    if (!active) return
    // Chrome can keep an AudioContext running for the whole Live call.
    // Do envelope sampling only while an authenticated harness response speaks.
    if (documentRoot.dataset.phoenixVoicePhase !== 'speaking') {
      documentRoot.dataset.phoenixVoiceMeter = 'idle'
      documentRoot.style.removeProperty('--phoenix-voice-level')
      sleeping = window.setTimeout(tick, 90)
      return
    }
    analyser.getByteTimeDomainData(samples)
    let energy = 0
    for (const point of samples) {
      const delta = (point - 128) / 128
      energy += delta * delta
    }
    const rms = Math.sqrt(energy / samples.length)
    const normalized = Math.min(1, Math.max(0, (rms - .012) * 9))
    documentRoot.style.setProperty('--phoenix-voice-level', normalized.toFixed(3))
    documentRoot.dataset.phoenixVoiceMeter = 'active'
    frame = window.requestAnimationFrame(tick)
  }
  void audioContext.resume().catch(() => {})
  tick()
  disposeCurrent = () => {
    active = false
    if (frame !== undefined) window.cancelAnimationFrame(frame)
    if (sleeping !== undefined) window.clearTimeout(sleeping)
    documentRoot.dataset.phoenixVoiceMeter = 'idle'
    documentRoot.style.removeProperty('--phoenix-voice-level')
    source.disconnect()
    analyser.disconnect()
    void audioContext.close().catch(() => {})
  }
}

/** Prevent old sessions from driving a new session's animated face. */
export function disconnectRealtimeAvatarVoiceMeter(): void {
  const previous = disposeCurrent
  disposeCurrent = undefined
  previous?.()
}
