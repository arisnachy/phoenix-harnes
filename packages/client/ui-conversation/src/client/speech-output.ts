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
  /** Browser pitch. */
  pitch?: number
  /** Browser output volume. */
  volume?: number
  /** Best matching installed voice, when the browser exposes its voice list. */
  voice?: SpeechSynthesisVoiceLike
}

/** Minimal installed voice metadata used to choose a natural voice. */
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

const HUMAN_FIELDS = ['summary', 'message', 'description', 'result', 'objective', 'title', 'details', 'reason'] as const
const TELEMETRY_LINE = /^\s*(?:tokens?|cache(?:[_ -]?(?:read|write|hit))?|revision|rev|sha|hash|id|usage|duration|timing|latency|elapsed|input[_ -]?tokens?|output[_ -]?tokens?)\s*[:=]\s*\S.*$/i
const STANDALONE_STATUS = /^\s*(?:done|complete|completed|pass|passed|success|successful|ok|blocked|failed|failure|error|needs[_ -]?changes)\s*[:.!-]*\s*$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function humanStatus(value: unknown, language: string): string | undefined {
  if (typeof value !== 'string') return undefined
  const status = value.trim().toLowerCase().replace(/[ -]+/g, '_')
  const spanish = language.toLowerCase().startsWith('es')
  if (['done', 'complete', 'completed', 'pass', 'passed', 'success', 'successful', 'ok'].includes(status)) {
    return spanish
      ? 'Terminé la tarea y la verificación salió bien.'
      : 'I finished the task and verification passed.'
  }
  if (['fail', 'failed', 'failure', 'error', 'needs_changes'].includes(status)) {
    return spanish
      ? 'Encontré un problema que debo corregir antes de dar la tarea por terminada.'
      : 'I found a problem that I need to fix before I can call the task complete.'
  }
  if (status === 'blocked') {
    return spanish
      ? 'Encontré un bloqueo externo que impide continuar por ahora.'
      : 'I found an external blocker that prevents me from continuing for now.'
  }
  return undefined
}

function structuredSpeechText(text: string, language: string): string | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  for (const field of HUMAN_FIELDS) {
    const value = parsed[field]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  for (const field of ['status', 'phase', 'verdict', 'state'] as const) {
    const spoken = humanStatus(parsed[field], language)
    if (spoken !== undefined) return spoken
  }
  return undefined
}

function removeTelemetryLines(text: string): string {
  const lines = text.split(/\r?\n/)
  const meaningful = lines.filter(line => !TELEMETRY_LINE.test(line) && !STANDALONE_STATUS.test(line))
  if (meaningful.some(line => line.trim() !== '')) return meaningful.join('\n')
  const status = lines.map(line => line.trim()).find(line => STANDALONE_STATUS.test(line))
  return status ?? text
}

function cleanSpeechMarkup(text: string): string {
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

/**
 * Convert assistant output into a short human transcript instead of reading
 * machine telemetry, identifiers, markup, or raw structured status aloud.
 * @param text - Assistant text before speech normalization.
 * @param language - BCP 47 language used for natural status fallbacks.
 * @returns Plain conversational text suitable for speech synthesis.
 */
export function conversationalSpeechText(text: string, language = defaultLanguage()): string {
  const structured = structuredSpeechText(text, language)
  const candidate = structured ?? removeTelemetryLines(text)
  const cleaned = cleanSpeechMarkup(candidate)
  if (structured === undefined && STANDALONE_STATUS.test(cleaned)) {
    return humanStatus(cleaned.replace(/[:.!-]+$/g, ''), language) ?? cleaned
  }
  return cleaned
}

/** Choose the closest installed voice, strongly preferring natural Spanish voices. */
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
      'alba', 'aria', 'ava', 'conchita', 'dalia', 'elena', 'elvira', 'emma', 'helena', 'isabela',
      'jenny', 'karen', 'laura', 'luciana', 'marisol', 'monica', 'mónica', 'paloma', 'paulina',
      'sabina', 'samantha', 'sofia', 'sofía', 'susan', 'ximena', 'zira', 'female', 'feminine', 'mujer',
    ].some(name => voice.name.toLowerCase().includes(name)) ? 100 : 0
    const languageScore = voiceLanguage === target ? 18 : 10
    const local = voice.localService === true ? 2 : 0
    const score = feminine + natural + languageScore + local
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
      const selectedLanguage = language?.trim() || defaultLanguage()
      const transcript = conversationalSpeechText(text, selectedLanguage)
      if (transcript === '') return
      if (synthesis === undefined || Utterance === undefined) {
        onState('unsupported')
        return
      }
      const current = ++epoch
      synthesis.cancel()
      const utterance = new Utterance(transcript)
      utterance.lang = selectedLanguage
      utterance.rate = 0.93
      utterance.pitch = 1
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
