/** Provider-neutral asynchronous voice capability for PHOENIX.
 *
 * Voice is an optional side channel. It consumes important durable events and
 * never participates in execution, planning, or completion decisions.
 * @module @phoenix-ai/dsh-voice
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type {} from '@phoenix-ai/dsh-session'

/** Events that are useful to hear without narrating ordinary execution. */
export type VoiceEventKind = 'mission-completed' | 'discovery' | 'blocked' | 'help' | 'authorization'

/** A display result explicitly selected for spoken output. */
export interface VoiceImportantEvent {
  /** The small set of events that may produce speech. */
  readonly kind: VoiceEventKind
  /** Formatted display text; it is normalized before being spoken. */
  readonly displayOutput: string
  /** Optional stable key used to suppress duplicate announcements. */
  readonly dedupeKey?: string
  /** Optional language override for this announcement. */
  readonly language?: string
}

/** Text sent to one text-to-speech provider. */
export interface VoiceSynthesisRequest {
  /** Plain spoken text, never display Markdown or code. */
  readonly text: string
  /** BCP 47 language tag. */
  readonly language: string
  /** Aborts queued or active provider work. */
  readonly signal?: AbortSignal
}

/** Audio sent to one speech-to-text provider. */
export interface VoiceTranscriptionRequest {
  /** Encoded microphone audio. */
  readonly audio: Uint8Array
  /** Audio MIME type supplied by the capture adapter. */
  readonly mimeType: string
  /** Requested language, when known. */
  readonly language?: string
  /** Aborts provider work. */
  readonly signal?: AbortSignal
}

/** Result returned by speech recognition. */
export interface VoiceTranscript {
  /** Recognized plain text. */
  readonly text: string
  /** Provider-reported language, when available. */
  readonly language?: string
  /** Provider confidence, when available. */
  readonly confidence?: number
}

/** A local or remote text-to-speech implementation. */
export interface VoiceTextToSpeechProvider {
  /** Stable provider id used by configuration. */
  readonly id: string
  /** Larger values win when no provider id is configured. */
  readonly priority: number
  /** Synchronous readiness check; it must not start model work. */
  available(): boolean
  /** Speak one already-normalized request. */
  speak(request: VoiceSynthesisRequest): Promise<void>
}

/** A local or remote speech-to-text implementation. */
export interface VoiceSpeechToTextProvider {
  /** Stable provider id used by configuration. */
  readonly id: string
  /** Larger values win when no provider id is configured. */
  readonly priority: number
  /** Synchronous readiness check; it must not start model work. */
  available(): boolean
  /** Transcribe one audio request. */
  transcribe(request: VoiceTranscriptionRequest): Promise<VoiceTranscript>
}

/** Branded id for one queued spoken announcement. */
export type VoiceAnnouncementId = string & { readonly __voiceAnnouncementId: unique symbol }

/** Immediate result from the non-blocking announcement API. */
export interface VoiceAnnouncementReceipt {
  /** Queue identity, useful for cancellation and diagnostics. */
  readonly id: VoiceAnnouncementId
  /** Whether the event entered the bounded side-channel queue. */
  readonly accepted: boolean
  /** Why an event was not accepted. */
  readonly reason?: 'disabled' | 'not-important' | 'empty' | 'queue-full' | 'duplicate' | 'no-provider'
  /** Normalized text, when accepted. */
  readonly text?: string
}

/** Observable health of the side-channel voice queue. */
export interface VoiceRuntimeStatus {
  /** Whether the capability accepts announcements. */
  readonly enabled: boolean
  /** Number of queued requests waiting for a provider. */
  readonly queued: number
  /** Whether a provider is currently speaking. */
  readonly speaking: boolean
  /** Selected provider ids, when currently available. */
  readonly ttsProvider?: string
  /** Selected STT provider id, when currently available. */
  readonly sttProvider?: string
}

/** Configurable limits and provider preference for one host. */
export interface VoiceRuntimeConfig {
  /** Keep false to disable all host-side voice output. */
  readonly enabled?: boolean
  /** Default BCP 47 language. */
  readonly language?: string
  /** Maximum pending important events. */
  readonly maxQueue?: number
  /** Maximum spoken characters per event. */
  readonly maxChars?: number
  /** Preferred TTS provider, normally `kokoro` when configured. */
  readonly ttsProvider?: string
  /** Preferred STT provider. */
  readonly sttProvider?: string
}

interface ResolvedVoiceRuntimeConfig {
  readonly enabled: boolean
  readonly language: string
  readonly maxQueue: number
  readonly maxChars: number
  readonly ttsProvider?: string
  readonly sttProvider?: string
}

interface QueuedAnnouncement {
  readonly id: VoiceAnnouncementId
  readonly event: VoiceImportantEvent
  readonly text: string
  readonly controller: AbortController
}

interface UnknownRecord {
  readonly [key: string]: unknown
}

declare module '@phoenix-ai/cordis' {
  interface Context {
    voice: VoiceRuntime
  }

  interface Events {
    /**
     * Emit one explicit important event for the asynchronous voice side channel.
     * @param event - event selected for spoken output.
     * @mode emit
     */
    'voice/important'(event: VoiceImportantEvent): void
  }
}

/**
 * Convert display content to short, natural spoken text.
 * @param displayOutput - Markdown, code, or formatted output shown on screen.
 * @param maxChars - Maximum output length; truncation prefers a sentence end.
 * @returns Plain text with visual-only markup, emoji, URLs, and secret-looking values removed.
 */
export function displayOutputToVoiceText(displayOutput: string, maxChars = 480): string {
  const normalized = displayOutput
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|secret|token)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[>*_~`|{}[\]\\]/g, ' ')
    .replace(/[\p{Extended_Pictographic}\u200D\uFE0F]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (normalized.length <= maxChars) return normalized
  const limit = Math.max(1, maxChars)
  const prefix = normalized.slice(0, limit)
  const sentenceEnd = Math.max(prefix.lastIndexOf('.'), prefix.lastIndexOf('!'), prefix.lastIndexOf('?'))
  return (sentenceEnd > 0 ? prefix.slice(0, sentenceEnd + 1) : prefix).trim()
}

/** Return one event only when it is an explicitly speakable important event.
 * @param input - untrusted session event candidate.
 * @returns a normalized important voice event, or undefined.
 */
export function sessionEventToVoiceEvent(input: unknown): VoiceImportantEvent | undefined {
  if (!isRecord(input) || typeof input.type !== 'string' || !isRecord(input.data)) return undefined
  const data = input.data
  const id = stringValue(data.id) ?? stringValue(data.goalId) ?? 'event'
  switch (input.type) {
    case 'approval/asked': {
      const toolName = stringValue(data.toolName) ?? 'an action'
      return {
        kind: 'authorization',
        displayOutput: `Authorization is required for ${toolName}.`,
        dedupeKey: `authorization:${id}`,
      }
    }
    case 'goal/judge': {
      const goalId = stringValue(data.goalId) ?? 'the mission'
      const verdict = data.verdict
      if (verdict === 'pass') {
        return { kind: 'mission-completed', displayOutput: `${goalId} completed and passed review.`, dedupeKey: `completed:${goalId}:${stringValue(data.revision) ?? 'current'}` }
      }
      if (verdict === 'blocked') {
        return { kind: 'blocked', displayOutput: `${goalId} is blocked and needs attention.`, dedupeKey: `blocked:${goalId}:${stringValue(data.revision) ?? 'current'}` }
      }
      return undefined
    }
    case 'goal/supervisor': {
      if (data.status !== 'blocked' && data.nextAction !== 'blocked') return undefined
      const goalId = stringValue(data.goalId) ?? 'the mission'
      return { kind: 'blocked', displayOutput: `${goalId} is blocked and needs attention.`, dedupeKey: `blocked:${goalId}:${stringValue(data.revision) ?? 'current'}` }
    }
    default:
      return undefined
  }
}

/** Provider registry and non-blocking important-event announcement queue. */
export class VoiceRuntime extends Service {
  static Config: z<VoiceRuntimeConfig> = z.object({
    enabled: z.boolean().default(true),
    language: z.string().default('en-US'),
    maxQueue: z.number().default(3),
    maxChars: z.number().default(480),
    ttsProvider: z.string(),
    sttProvider: z.string(),
  })

  private readonly config: ResolvedVoiceRuntimeConfig
  private readonly ttsProviders = new Map<string, VoiceTextToSpeechProvider>()
  private readonly sttProviders = new Map<string, VoiceSpeechToTextProvider>()
  private readonly queue: QueuedAnnouncement[] = []
  private readonly pendingKeys = new Set<string>()
  private current: QueuedAnnouncement | undefined
  private draining = false

  constructor(ctx: Context, config: VoiceRuntimeConfig = {}) {
    super(ctx, 'voice')
    this.config = {
      enabled: config.enabled ?? true,
      language: config.language?.trim() || 'en-US',
      maxQueue: positiveInteger(config.maxQueue ?? 3, 'maxQueue'),
      maxChars: positiveInteger(config.maxChars ?? 480, 'maxChars'),
      ...config.ttsProvider?.trim() ? { ttsProvider: config.ttsProvider.trim() } : {},
      ...config.sttProvider?.trim() ? { sttProvider: config.sttProvider.trim() } : {},
    }
    ctx.on('voice/important', (event) => { void this.announce(event) })
    ctx.on('session/event', (_session, event) => {
      const important = sessionEventToVoiceEvent(event)
      if (important !== undefined) void this.announce(important)
    })
    ctx.effect(() => () => { this.stop() }, 'voice queue teardown')
  }

  /**
   * Register a TTS provider and dispose it with its contributing fiber.
   * @param provider - Provider implementation with a unique id.
   * @returns A synchronous disposer for the registration.
   */
  registerTextToSpeechProvider(provider: VoiceTextToSpeechProvider): () => void {
    return this.registerProvider(this.ttsProviders, provider)
  }

  /**
   * Register an STT provider and dispose it with its contributing fiber.
   * @param provider - Provider implementation with a unique id.
   * @returns A synchronous disposer for the registration.
   */
  registerSpeechToTextProvider(provider: VoiceSpeechToTextProvider): () => void {
    return this.registerProvider(this.sttProviders, provider)
  }

  /**
   * Queue one important event and return immediately; provider work is detached.
   * @param event - Important event with display-formatted output.
   * @returns Immediate queue receipt; it never waits for audio.
   */
  announce(event: VoiceImportantEvent): VoiceAnnouncementReceipt {
    const id = randomUUID() as VoiceAnnouncementId
    if (!this.config.enabled) return { id, accepted: false, reason: 'disabled' }
    if (!isVoiceEventKind(event.kind)) return { id, accepted: false, reason: 'not-important' }
    const text = displayOutputToVoiceText(event.displayOutput, this.config.maxChars)
    if (text === '') return { id, accepted: false, reason: 'empty' }
    const key = event.dedupeKey
    if (key !== undefined && (this.pendingKeys.has(key) || this.current?.event.dedupeKey === key)) {
      return { id, accepted: false, reason: 'duplicate' }
    }
    if (this.queue.length >= this.config.maxQueue) return { id, accepted: false, reason: 'queue-full' }
    if (this.selectTtsProvider() === undefined) return { id, accepted: false, reason: 'no-provider' }
    const queued: QueuedAnnouncement = { id, event, text, controller: new AbortController() }
    this.queue.push(queued)
    if (key !== undefined) this.pendingKeys.add(key)
    void this.drain()
    return { id, accepted: true, text }
  }

  /**
   * Dispatch one important event through the Cordis event seam.
   * @param event - Important event with display-formatted output.
   */
  emitImportant(event: VoiceImportantEvent): void {
    this.ctx.emit('voice/important', event)
  }

  /**
   * Cancel a queued or currently speaking announcement.
   * @param id - Queue identity returned by {@link announce}.
   * @returns Whether an announcement was found and cancelled.
   */
  cancel(id: VoiceAnnouncementId): boolean {
    const queued = this.queue.findIndex(item => item.id === id)
    if (queued >= 0) {
      const [item] = this.queue.splice(queued, 1)
      if (item?.event.dedupeKey !== undefined) this.pendingKeys.delete(item.event.dedupeKey)
      item?.controller.abort('announcement cancelled')
      return true
    }
    if (this.current?.id !== id) return false
    this.current.controller.abort('announcement cancelled')
    return true
  }

  /** Abort current speech and discard queued speech. */
  stop(): void {
    for (const item of this.queue) item.controller.abort('voice stopped')
    this.queue.length = 0
    this.pendingKeys.clear()
    this.current?.controller.abort('voice stopped')
  }

  /**
   * Transcribe audio through the selected provider without entering the TTS queue.
   * @param request - Audio bytes and capture metadata.
   * @returns The provider transcript.
   */
  async transcribe(request: VoiceTranscriptionRequest): Promise<VoiceTranscript> {
    const provider = this.selectSttProvider()
    if (provider === undefined) throw new Error('voice: no available speech-to-text provider')
    return provider.transcribe(request)
  }

  /**
   * Report current side-channel state for UI and diagnostics.
   * @returns Current queue, speaking, and selected-provider state.
   */
  status(): VoiceRuntimeStatus {
    const ttsProvider = this.selectTtsProvider()
    const sttProvider = this.selectSttProvider()
    return {
      enabled: this.config.enabled,
      queued: this.queue.length,
      speaking: this.current !== undefined,
      ...ttsProvider === undefined ? {} : { ttsProvider: ttsProvider.id },
      ...sttProvider === undefined ? {} : { sttProvider: sttProvider.id },
    }
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (provider.id.trim() === '') throw new Error('voice: provider id must not be empty')
    if (store.has(provider.id)) throw new Error(`voice: provider "${provider.id}" is already registered`)
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'voice provider registration')
    return () => { void dispose() }
  }

  private selectTtsProvider(): VoiceTextToSpeechProvider | undefined {
    return selectProvider(this.ttsProviders, this.config.ttsProvider)
  }

  private selectSttProvider(): VoiceSpeechToTextProvider | undefined {
    return selectProvider(this.sttProviders, this.config.sttProvider)
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()
        if (item === undefined) continue
        if (item.event.dedupeKey !== undefined) this.pendingKeys.delete(item.event.dedupeKey)
        const provider = this.selectTtsProvider()
        if (provider === undefined) continue
        this.current = item
        try {
          await provider.speak({ text: item.text, language: item.event.language ?? this.config.language, signal: item.controller.signal })
        } catch (error) {
          if (!item.controller.signal.aborted) this.ctx.logger('voice').warn(`voice provider "${provider.id}" failed: ${String(error)}`)
        } finally {
          this.current = undefined
        }
      }
    } finally {
      this.draining = false
    }
  }
}

function selectProvider<P extends { readonly id: string; readonly priority: number; available(): boolean }>(
  providers: ReadonlyMap<string, P>,
  configuredId: string | undefined,
): P | undefined {
  if (configuredId !== undefined) {
    const configured = providers.get(configuredId)
    if (configured?.available() === true) return configured
  }
  return [...providers.values()]
    .filter(provider => provider.available())
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0]
}

function isVoiceEventKind(value: string): value is VoiceEventKind {
  return value === 'mission-completed' || value === 'discovery' || value === 'blocked' || value === 'help' || value === 'authorization'
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`voice: config.${field} must be a positive integer`)
  return value
}

export default VoiceRuntime
