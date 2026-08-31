/** Browser-native voice input adapter used by the conversation composer. */

import { createSpeechOutput, hasSpeechOutput, type SpeechOutput } from './speech-output.ts'

/** States exposed by the short-lived browser recognition session. */
export type VoiceInputState = 'idle' | 'listening' | 'unsupported' | 'permission-denied' | 'error'

/** Public phase of the browser-native, hands-free assistant mode. */
export type VoiceAssistantPhase = 'inactive' | 'paused' | 'listening' | 'speaking'

/** Snapshot shared by the composer and finalized assistant-message tails. */
export interface VoiceAssistantSnapshot {
  readonly active: boolean
  readonly phase: VoiceAssistantPhase
  /** Wall-clock activation point used to avoid reading old history on enable. */
  readonly activatedAt: number
}

const INACTIVE_VOICE_ASSISTANT: VoiceAssistantSnapshot = Object.freeze({
  active: false,
  phase: 'inactive',
  activatedAt: 0,
})
let voiceAssistantSnapshot: VoiceAssistantSnapshot = INACTIVE_VOICE_ASSISTANT
const voiceAssistantListeners = new Set<() => void>()
const spokenAssistantMessages = new Set<string>()
let voiceAssistantSpeech: SpeechOutput | undefined

function publishVoiceAssistant(next: VoiceAssistantSnapshot): void {
  voiceAssistantSnapshot = next
  for (const listener of voiceAssistantListeners) listener()
}

/**
 * Subscribe to hands-free assistant mode changes for a browser component.
 * @param listener - Callback invoked after the immutable mode snapshot changes.
 * @returns Disposer that removes the listener.
 */
export function subscribeVoiceAssistant(listener: () => void): () => void {
  voiceAssistantListeners.add(listener)
  return () => { voiceAssistantListeners.delete(listener) }
}

/**
 * Read the current hands-free assistant mode without exposing mutable state.
 * @returns The current immutable assistant-mode snapshot.
 */
export function getVoiceAssistantSnapshot(): VoiceAssistantSnapshot {
  return voiceAssistantSnapshot
}

/**
 * Enable or disable the explicit hands-free assistant mode.
 * @param active - Whether hands-free recognition and response speech remain enabled.
 */
export function setVoiceAssistantActive(active: boolean): void {
  if (!active) {
    voiceAssistantSpeech?.stop()
    voiceAssistantSpeech?.dispose()
    voiceAssistantSpeech = undefined
    spokenAssistantMessages.clear()
    if (voiceAssistantSnapshot.active) publishVoiceAssistant(INACTIVE_VOICE_ASSISTANT)
    return
  }
  if (voiceAssistantSnapshot.active) return
  spokenAssistantMessages.clear()
  publishVoiceAssistant({ active: true, phase: 'paused', activatedAt: Date.now() })
}

/**
 * Reflect whether the recognizer is currently listening.
 * @param listening - Whether the browser recognizer has an active segment.
 */
export function setVoiceAssistantListening(listening: boolean): void {
  if (!voiceAssistantSnapshot.active || voiceAssistantSnapshot.phase === 'speaking') return
  publishVoiceAssistant({
    ...voiceAssistantSnapshot,
    phase: listening ? 'listening' : 'paused',
  })
}

/**
 * Speak one newly completed assistant message while hands-free mode is active.
 * Old history is ignored by the activation-time fence and each rendered message
 * key is spoken once, even when the transcript projection re-renders.
 * @param messageKey - stable conversation identity of the assistant message.
 * @param text - finalized assistant prose.
 * @param messageTime - durable event time in Unix milliseconds.
 */
export function speakVoiceAssistantResponse(messageKey: string, text: string, messageTime: number): void {
  if (!voiceAssistantSnapshot.active || text.trim() === '' || messageTime < voiceAssistantSnapshot.activatedAt - 1_000) return
  if (spokenAssistantMessages.has(messageKey)) return
  if (!hasSpeechOutput()) return
  spokenAssistantMessages.add(messageKey)
  if (voiceAssistantSpeech === undefined) {
    voiceAssistantSpeech = createSpeechOutput((state) => {
      if (!voiceAssistantSnapshot.active) return
      if (state === 'speaking') {
        publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'speaking' })
      } else {
        publishVoiceAssistant({ ...voiceAssistantSnapshot, phase: 'paused' })
      }
    })
  }
  voiceAssistantSpeech.speak(text)
}

/** Minimal result event needed from SpeechRecognition across browser vendors. */
export interface VoiceRecognitionResultEvent {
  readonly resultIndex?: number
  readonly results: {
    readonly length: number
    readonly [index: number]: {
      readonly isFinal?: boolean
      readonly [index: number]: { readonly transcript?: string } | undefined
    } | undefined
  }
}

/** Browser event surface used by the adapter and test doubles. */
export interface VoiceRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { readonly error?: string }) => void) | null
  onresult: ((event: VoiceRecognitionResultEvent) => void) | null
  start(): void
  stop(): void
  abort(): void
}

/** Constructor exposed by Chromium and WebKit for native speech recognition. */
export interface VoiceRecognitionConstructor {
  new (): VoiceRecognitionLike
}

/** Window subset needed to resolve the native recognition constructor. */
export interface VoiceRecognitionWindow {
  readonly SpeechRecognition?: VoiceRecognitionConstructor
  readonly webkitSpeechRecognition?: VoiceRecognitionConstructor
}

/**
 * Find the browser's native speech-recognition implementation, if present.
 * @param scope - browser-like object to inspect.
 * @returns the available recognition constructor, or undefined when unsupported.
 */
export function voiceRecognitionConstructor(scope: VoiceRecognitionWindow | undefined =
  typeof window === 'undefined' ? undefined : window as VoiceRecognitionWindow): VoiceRecognitionConstructor | undefined {
  return scope?.SpeechRecognition ?? scope?.webkitSpeechRecognition
}

/**
 * Test whether the current browser can provide native voice dictation.
 * @param scope - browser-like object to inspect.
 * @returns true when a native recognition constructor is available.
 */
export function hasVoiceRecognition(scope: VoiceRecognitionWindow | undefined =
  typeof window === 'undefined' ? undefined : window as VoiceRecognitionWindow): boolean {
  return voiceRecognitionConstructor(scope) !== undefined
}

/**
 * Create one explicit, non-persistent recognition session.
 * @param onTranscript - receives only final, trimmed transcript fragments.
 * @param onState - receives lifecycle and permission state changes.
 * @param language - BCP-47 language sent to the browser recognizer.
 * @param scope - browser window used to resolve the constructor.
 * @returns configured recognition session, or undefined when unsupported.
 */
export function createVoiceRecognition(
  onTranscript: (text: string) => void,
  onState: (state: VoiceInputState) => void,
  language = typeof navigator === 'undefined' ? 'en-US' : navigator.language,
  scope: VoiceRecognitionWindow | undefined = typeof window === 'undefined' ? undefined : window as VoiceRecognitionWindow,
): VoiceRecognitionLike | undefined {
  const Constructor = voiceRecognitionConstructor(scope)
  if (Constructor === undefined) return undefined
  const recognition = new Constructor()
  recognition.lang = language
  recognition.continuous = true
  recognition.interimResults = false
  recognition.maxAlternatives = 1
  recognition.onstart = () => { onState('listening') }
  recognition.onend = () => { onState('idle') }
  recognition.onerror = (event) => {
    onState(event.error === 'not-allowed' || event.error === 'service-not-allowed'
      ? 'permission-denied'
      : 'error')
  }
  recognition.onresult = (event) => {
    const start = event.resultIndex ?? 0
    const fragments: string[] = []
    for (let index = start; index < event.results.length; index += 1) {
      const result = event.results[index]
      if (result?.isFinal === false) continue
      const transcript = result?.[0]?.transcript?.trim()
      if (transcript !== undefined && transcript !== '') fragments.push(transcript)
    }
    if (fragments.length > 0) onTranscript(fragments.join(' '))
  }
  return recognition
}
