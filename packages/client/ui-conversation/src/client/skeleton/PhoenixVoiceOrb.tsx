/** In-composer PHOENIX voice emblem with passive, level-reactive animation.
 * Audio is sampled only for visualization; the native WebRTC speaker stays untouched.
 */
import { useEffect, useRef } from 'react'
import { getVoiceAvatarAudioStream, type VoiceAssistantPhase } from '../voice.ts'
import css from './InputBar.module.css'

/** Compact microphone emblem; never mounts a floating overlay over chat messages. */
export function PhoenixVoiceOrb({ phase, native }: {
  readonly phase: VoiceAssistantPhase
  readonly native: boolean
}) {
  const orbRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (phase !== 'listening' && phase !== 'speaking') return
    const element = orbRef.current
    if (element === null) return

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const samples = new Float32Array(512)
    let frame = 0
    let stream: MediaStream | undefined
    let context: AudioContext | undefined
    let analyser: AnalyserNode | undefined
    let smoothed = 0

    const tick = (): void => {
      const next = native ? getVoiceAvatarAudioStream(phase === 'speaking' ? 'output' : 'input') : undefined
      if (next !== stream) {
        if (context !== undefined) void context.close().catch(() => undefined)
        context = undefined
        analyser = undefined
        stream = next
        if (next !== undefined && next.getAudioTracks().length > 0 && typeof AudioContext !== 'undefined') {
          try {
            const audioContext = new AudioContext()
            const source = audioContext.createMediaStreamSource(next)
            const meter = audioContext.createAnalyser()
            meter.fftSize = 1024
            source.connect(meter)
            // Never connect this analysis-only node to the output destination.
            context = audioContext
            analyser = meter
            void audioContext.resume().catch(() => undefined)
          } catch {
            if (context !== undefined) void context.close().catch(() => undefined)
            context = undefined
            analyser = undefined
          }
        }
      }
      let level = phase === 'speaking' ? 0.14 : 0.07
      if (analyser !== undefined && context?.state === 'running') {
        analyser.getFloatTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) sum += sample * sample
        level = Math.min(1, Math.sqrt(sum / samples.length) * 5)
      }
      smoothed += (level - smoothed) * 0.18
      element.style.setProperty('--phoenix-orb-scale', String(1 + (reduced ? 0 : smoothed * 0.2)))
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(frame)
      if (context !== undefined) void context.close().catch(() => undefined)
    }
  }, [phase, native])

  return (
    <span ref={orbRef} className={css.voiceOrb} data-phoenix-voice-orb aria-hidden="true">
      <img className={css.voiceEmblem} src="/phoenix-emblem.png" alt="" />
    </span>
  )
}
