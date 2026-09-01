/** Browser-native speech output used by assistant message actions. */

export type SpeechOutputState = 'idle' | 'speaking' | 'unsupported'

/** Minimal synthesis utterance surface used by the adapter and its tests. */
export interface SpeechSynthesisUtteranceLike {
  /** Text that the browser will read. */
  readonly text: string
  /** BCP 47 language tag selected for this utterance. */
  lang: string
  /** Called when the browser finishes or cancels the utterance. */
  onend: (() => void) | null
  /** Called when the browser cannot synthesize the utterance. */
  onerror: (() => void) | null
  /** Browser speech rate; a slightly slower cadence sounds less mechanical. */
  rate?: number
  /** Browser pitch; a small lift keeps the voice conversational. */
  pitch?: number
  /** Browser output volume. */
  volume?: number
  /** Best matching installed voice, when the browser exposes its voice list. */
  voice?: SpeechSynthesisVoiceLike
}

/** Minimal installed voice metadata used to choose a natural local voice. */
export interface SpeechSynthesisVoiceLike {
  readonly name: string
  readonly lang: string
  readonly localService?: boolean
}

/** Minimal browser synthesis service surface. */
export interface SpeechSynthesisLike {
  /** Cancel the current queue. */
  cancel(): void
  /** Queue one utterance. */
  speak(utterance: SpeechSynthesisUtteranceLike): void
  /** Installed voices; browsers may return an empty list until voices load. */
  getVoices?: () => readonly SpeechSynthesisVoiceLike[]
}

/** Browser globals required to construct local speech output. */
export interface SpeechOutputScope {
  readonly speechSynthesis?: SpeechSynthesisLike
  readonly SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtteranceLike
}

/** Handle returned to the UI for one assistant speech-output control. */
export interface SpeechOutput {
  /** Read one non-empty transcript, replacing any queued utterance. */
  speak(text: string): void
  /** Cancel the current utterance and return to the idle state. */
  stop(): void
  /** Release the current utterance when the owning message unmounts. */
  dispose(): void
}

function defaultScope(): SpeechOutputScope | undefined {
  if (typeof window === 'undefined') return undefined
  return window as unknown as SpeechOutputScope
}

function defaultLanguage(): string {
  if (typeof navigator === 'undefined' || navigator.language.trim() === '') return 'en-US'
  return navigator.language
}

/**
 * Remove formatting that should not be read aloud as punctuation or markup.
 * @param text - Assistant text before speech normalization.
 * @returns Plain conversational text suitable for speech synthesis.
 */
export function conversationalSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(["']?)(?:api[_-]?(?:key|secret)|access[_-]?token|auth(?:orization)?|auth[_-]?token|client[_-]?secret|password|private[_-]?key|refresh[_-]?token|secret|session[_-]?token|token)\1\s*[:=]\s*(?:bearer\s+)?(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gi, '[redacted]')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[>*_~`|{}[\]\\]/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u200D\uFE0F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
}

/** Choose the closest installed voice, preferring language and local natural voices. */
function bestVoice(synthesis: SpeechSynthesisLike, language: string): SpeechSynthesisVoiceLike | undefined {
  const voices = synthesis.getVoices?.() ?? []
  const target = language.toLowerCase()
  const base = target.split('-')[0]
  let best: { voice: SpeechSynthesisVoiceLike; score: number } | undefined
  for (const voice of voices) {
    const voiceLanguage = voice.lang.toLowerCase()
    const voiceBase = voiceLanguage.split('-')[0]
    if (voiceBase !== base) continue
    const natural = /natural|neural|premium|enhanced/i.test(voice.name) ? 4 : 0
    const feminine = [
      'aria', 'samantha', 'sofia', 'sofía', 'jenny', 'sabina', 'zira', 'karen', 'susan',
      'helena', 'luciana', 'marisol', 'paulina', 'ava', 'emma', 'laura', 'female', 'feminine', 'mujer',
    ].some(name => voice.name.toLowerCase().includes(name)) ? 12 : 0
    const score = feminine * 100 + (voiceLanguage === target ? 18 : 10) + (voice.localService === true ? 3 : 0) + natural
    if (best === undefined || score > best.score) best = { voice, score }
  }
  return best?.voice
}

function resolveScope(scope: SpeechOutputScope | undefined): SpeechOutputScope | undefined {
  return scope ?? defaultScope()
}

/**
 * Report whether the current browser exposes both synthesis and utterances.
 * @param scope - Optional browser-like scope for tests or an embedded client.
 * @returns Whether local speech output can be constructed.
 */
export function hasSpeechOutput(scope?: SpeechOutputScope): boolean {
  const resolved = resolveScope(scope)
  return resolved?.speechSynthesis !== undefined && resolved.SpeechSynthesisUtterance !== undefined
}

/**
 * Construct a cancellable local speech-output adapter.
 * @param onState - Receives only durable UI states for this control.
 * @param language - Optional BCP 47 language tag; defaults to browser language.
 * @param scope - Optional browser-like scope for tests or an embedded client.
 * @returns Cancellable speech-output handle.
 */
export function createSpeechOutput(
  onState: (state: SpeechOutputState) => void,
  language?: string,
  scope?: SpeechOutputScope,
): SpeechOutput {
  const resolved = resolveScope(scope)
  const synthesis = resolved?.speechSynthesis
  const Utterance = resolved?.SpeechSynthesisUtterance
  let epoch = 0
  let active = false

  const finish = (current: number): void => {
    if (current !== epoch) return
    active = false
    onState('idle')
  }

  const stop = (): void => {
    epoch += 1
    if (synthesis === undefined) {
      active = false
      onState('unsupported')
      return
    }
    synthesis.cancel()
    if (active) {
      active = false
      onState('idle')
    }
  }

  return {
    speak(text: string): void {
      const transcript = conversationalSpeechText(text)
      if (transcript === '') return
      if (synthesis === undefined || Utterance === undefined) {
        onState('unsupported')
        return
      }
      const current = ++epoch
      synthesis.cancel()
      const utterance = new Utterance(transcript)
      const selectedLanguage = language?.trim() || defaultLanguage()
      utterance.lang = selectedLanguage
      utterance.rate = 0.96
      utterance.pitch = 1.02
      utterance.volume = 0.98
      const voice = bestVoice(synthesis, selectedLanguage)
      if (voice !== undefined) utterance.voice = voice
      utterance.onend = () => { finish(current) }
      utterance.onerror = () => { finish(current) }
      active = true
      onState('speaking')
      synthesis.speak(utterance)
    },
    stop,
    dispose(): void {
      epoch += 1
      synthesis?.cancel()
      active = false
    },
  }
}
