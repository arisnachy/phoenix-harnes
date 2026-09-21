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
  /** Browser speech rate. */
  rate?: number
  /** Browser pitch. */
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
  /** Read one complete transcript, replacing any queued utterance. */
  speak(text: string): void
  /**
   * Feed a growing assistant transcript. Stable semantic chunks are queued as
   * soon as they are speakable; final flushes the remaining tail.
   */
  update(text: string, final?: boolean): void
  /** Cancel the current utterance and return to the idle state. */
  stop(): void
  /** Release the current utterance when the owning message unmounts. */
  dispose(): void
}

interface PlannedSpeechSegment {
  readonly text: string
  readonly end: number
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

/** Choose the closest installed voice, strongly preferring neural/natural voices. */
function bestVoice(synthesis: SpeechSynthesisLike, language: string): SpeechSynthesisVoiceLike | undefined {
  const voices = synthesis.getVoices?.() ?? []
  const target = language.toLowerCase()
  const base = target.split('-')[0]
  let best: { voice: SpeechSynthesisVoiceLike; score: number } | undefined
  for (const voice of voices) {
    const voiceLanguage = voice.lang.toLowerCase()
    const voiceBase = voiceLanguage.split('-')[0]
    if (voiceBase !== base) continue
    const natural = /natural|neural|premium|enhanced/i.test(voice.name) ? 60 : 0
    const feminine = [
      'aria', 'samantha', 'sofia', 'sofía', 'jenny', 'sabina', 'zira', 'karen', 'susan',
      'helena', 'luciana', 'marisol', 'paulina', 'ava', 'emma', 'laura', 'female', 'feminine', 'mujer',
    ].some(name => voice.name.toLowerCase().includes(name)) ? 50 : 0
    const score = natural + feminine
      + (voiceLanguage === target ? 18 : 10)
      + (voice.localService === true ? 3 : 0)
    if (best === undefined || score > best.score) best = { voice, score }
  }
  return best?.voice
}

function resolveScope(scope: SpeechOutputScope | undefined): SpeechOutputScope | undefined {
  return scope ?? defaultScope()
}

/** Find the next safe semantic boundary in a growing transcript. */
function nextSpeechSegment(text: string, from: number, final: boolean): PlannedSpeechSegment | undefined {
  let start = from
  while (start < text.length && /\s/u.test(text[start] ?? '')) start += 1
  if (start >= text.length) return undefined
  const remaining = text.slice(start)
  const maxChars = 180
  const eagerChars = 96
  const hardStartChars = 124

  const sentence = /[.!?…][”"'»)]?(?=\s|$)/gu
  const sentenceMatch = sentence.exec(remaining)
  if (sentenceMatch !== null) {
    const end = (sentenceMatch.index ?? 0) + sentenceMatch[0].length
    if (end <= maxChars) {
      return { text: remaining.slice(0, end).trim(), end: start + end }
    }
  }

  const window = remaining.slice(0, Math.min(maxChars, remaining.length))
  let clauseEnd = -1
  for (const match of window.matchAll(/[,;:](?=\s|$)/gu)) {
    const end = (match.index ?? 0) + match[0].length
    if (end >= 48) clauseEnd = end
  }
  if (clauseEnd > 0 && (final || remaining.length >= eagerChars)) {
    return { text: remaining.slice(0, clauseEnd).trim(), end: start + clauseEnd }
  }

  if (!final && remaining.length < hardStartChars) return undefined
  if (final && remaining.length <= maxChars) {
    return { text: remaining.trim(), end: text.length }
  }

  const target = Math.min(maxChars, remaining.length)
  const whitespace = remaining.lastIndexOf(' ', target)
  const cut = whitespace >= 64 ? whitespace : target
  return { text: remaining.slice(0, cut).trim(), end: start + cut }
}

function configureProsody(utterance: SpeechSynthesisUtteranceLike, text: string): void {
  const question = /[?¿]\s*$/u.test(text)
  const energetic = /!\s*$/u.test(text)
  utterance.rate = text.length > 150 ? 0.95 : energetic ? 0.99 : 0.97
  utterance.pitch = question ? 1.01 : 1
  utterance.volume = 0.98
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
 * Construct a cancellable, streaming local speech-output adapter.
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
  const selectedLanguage = language?.trim() || defaultLanguage()
  let epoch = 0
  let active = false
  let transcript = ''
  let queuedThrough = 0
  let pending = 0

  const setSpeaking = (): void => {
    if (active) return
    active = true
    onState('speaking')
  }

  const finishOne = (current: number): void => {
    if (current !== epoch) return
    pending = Math.max(0, pending - 1)
    if (pending !== 0) return
    active = false
    onState('idle')
  }

  const clear = (notify: boolean): void => {
    epoch += 1
    synthesis?.cancel()
    transcript = ''
    queuedThrough = 0
    pending = 0
    if (active) {
      active = false
      if (notify) onState('idle')
    }
  }

  const enqueue = (segment: string): void => {
    if (synthesis === undefined || Utterance === undefined || segment === '') return
    const current = epoch
    const utterance = new Utterance(segment)
    utterance.lang = selectedLanguage
    configureProsody(utterance, segment)
    const voice = bestVoice(synthesis, selectedLanguage)
    if (voice !== undefined) utterance.voice = voice
    utterance.onend = () => { finishOne(current) }
    utterance.onerror = () => { finishOne(current) }
    pending += 1
    setSpeaking()
    synthesis.speak(utterance)
  }

  const update = (text: string, final = false): void => {
    const next = conversationalSpeechText(text)
    if (next === '') return
    if (synthesis === undefined || Utterance === undefined) {
      onState('unsupported')
      return
    }

    if (transcript === '') {
      // Claim the browser speech queue only once for this growing response.
      synthesis.cancel()
    } else if (!next.startsWith(transcript)) {
      // Retry/rewrite changed already-observed text. Fence old callbacks and
      // restart from the corrected transcript rather than speaking stale prose.
      clear(false)
      synthesis.cancel()
    }
    transcript = next

    while (true) {
      const planned = nextSpeechSegment(transcript, queuedThrough, final)
      if (planned === undefined) break
      queuedThrough = planned.end
      enqueue(planned.text)
    }
  }

  const stop = (): void => {
    if (synthesis === undefined) {
      active = false
      onState('unsupported')
      return
    }
    clear(true)
  }

  return {
    speak(text: string): void {
      const normalized = conversationalSpeechText(text)
      if (normalized === '') return
      if (synthesis === undefined || Utterance === undefined) {
        onState('unsupported')
        return
      }
      clear(false)
      update(normalized, true)
    },
    update,
    stop,
    dispose(): void {
      clear(false)
    },
  }
}
