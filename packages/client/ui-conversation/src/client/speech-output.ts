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
}

/** Minimal browser synthesis service surface. */
export interface SpeechSynthesisLike {
  /** Cancel the current queue. */
  cancel(): void
  /** Queue one utterance. */
  speak(utterance: SpeechSynthesisUtteranceLike): void
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
      const transcript = text.trim()
      if (transcript === '') return
      if (synthesis === undefined || Utterance === undefined) {
        onState('unsupported')
        return
      }
      synthesis.cancel()
      const current = ++epoch
      const utterance = new Utterance(transcript)
      utterance.lang = language?.trim() || defaultLanguage()
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
