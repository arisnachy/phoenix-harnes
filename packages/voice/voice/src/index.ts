/** Provider-neutral asynchronous voice capability for PHOENIX.
 *
 * Voice is an optional side channel for announcements and speech output. A
 * finalized realtime user transcript is ordinary conversation input: when its
 * Phoenix Agent is live it enters that Agent's inbox, so planning, tools,
 * hardness policy, persistence, and completion all stay on the normal harness.
 * @module @phoenix-ai/dsh-voice
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@phoenix-ai/cordis'
import { Remote, TypertRemoteService } from '@phoenix-ai/dsh-typert-protocol'
import z from '@phoenix-ai/schemastery'
import { SessionId } from '@phoenix-ai/dsh-session'
import { createAssistantMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
import type {
  VoiceConversationCancelReceipt,
  VoiceConversationCancelRequest,
  VoiceConversationRealtimeStartReceipt,
  VoiceConversationRealtimeStartRequest,
  VoiceConversationRealtimeStatus,
  VoiceConversationRealtimeStopReceipt,
  VoiceConversationRealtimeStopRequest,
  VoiceConversationSpeakReceipt,
  VoiceConversationSpeakRequest,
  VoiceConversationStatus,
} from './types.ts'
import {
  CodexRealtimeBridge,
  type CodexRealtimeInitialItem,
  type CodexRealtimeTranscript,
  type CodexRealtimeVoice,
} from './codex-realtime.ts'

export type * from './types.ts'

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
  readonly reason?: 'disabled' | 'not-important' | 'empty' | 'queue-full' | 'duplicate' | 'no-provider' | 'native-realtime'
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
  /** Native Codex/ChatGPT realtime voice, using Codex login rather than API keys. */
  readonly codexRealtime?: boolean
}

interface ResolvedVoiceRuntimeConfig {
  readonly enabled: boolean
  readonly language: string
  readonly maxQueue: number
  readonly maxChars: number
  readonly ttsProvider?: string
  readonly sttProvider?: string
  readonly codexRealtime: boolean
}

interface QueuedAnnouncement {
  readonly id: VoiceAnnouncementId
  readonly event: VoiceImportantEvent
  readonly text: string
  readonly controller: AbortController
}

interface ConversationSpeechChannel {
  lastSequence: number
  readonly controllers: Set<AbortController>
  tail: Promise<void>
}

interface UnknownRecord {
  readonly [key: string]: unknown
}

type RealtimeAssistantGender = 'masculine' | 'feminine' | 'neutral'

interface RealtimeAssistantIdentity {
  readonly name: string
  readonly gender: RealtimeAssistantGender
  readonly voice: CodexRealtimeVoice
}

interface RealtimeTranscriptTurn {
  readonly turn: number
  readonly step: number
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


/** Use PHOENIX's persisted panel locale, not the machine's TTS defaults. */
export function voiceLanguageForPanel(locale: unknown, fallback = 'es-DO'): string {
  if (locale === 'es') return 'es-DO'
  if (locale === 'en') return 'en-US'
  if (locale === 'zh') return 'zh-CN'
  return fallback
}

/** The Host has only the user's explicitly selected locale, never browser globals. */
function panelVoiceLanguage(ctx: Context, fallback: string): string {
  const settings = (ctx as unknown as {
    get(name: string): { describe?: () => readonly { ns: string; user?: unknown }[] } | undefined
  }).get('settings')
  try {
    const locale = settings?.describe?.().find(row => row.ns === 'locale')?.user
    if (isRecord(locale)) return voiceLanguageForPanel(locale.preference, fallback)
  } catch {
    // Settings is optional during initial boot; voice must remain available.
  }
  return fallback
}

const EVENT_COPY: Record<string, Record<VoiceEventKind, string>> = {
  es: {
    'mission-completed': 'La tarea está lista y ha pasado la revisión.',
    discovery: 'Encontré una novedad importante.',
    blocked: 'Necesito tu ayuda para continuar con la tarea.',
    help: 'Necesito tu ayuda para continuar.',
    authorization: 'Necesito tu autorización para continuar.',
  },
  en: {
    'mission-completed': 'The task is complete and has passed review.',
    discovery: 'I found an important update.',
    blocked: 'I need your input before I can continue with the task.',
    help: 'I need your help to continue.',
    authorization: 'I need your approval before I can continue.',
  },
  zh: {
    'mission-completed': '任务已完成并通过审核。',
    discovery: '我发现了一项重要更新。',
    blocked: '我需要你的帮助才能继续执行任务。',
    help: '我需要你的帮助才能继续。',
    authorization: '继续之前需要你的授权。',
  },
}

/** Never pronounce a conspicuously different language with the panel voice. */
export function localizedImportantSpeech(event: VoiceImportantEvent, language: string): string {
  const locale = language.toLowerCase().split('-')[0] ?? 'es'
  const text = displayOutputToVoiceText(event.displayOutput)
  const containsHan = /[\p{Script=Han}]/u.test(text)
  const english = /\b(?:everything|all is ready|ready|the task|task is|completed|finished|approval|i need|before i|continue|found|successfully|waiting for)\b/i.test(text)
  const spanish = /\b(?:la tarea|está lista|terminad[oa]|completad[oa]|necesito|autorización|continuar|encontré|revisión|aprobación)\b/i.test(text)
  const incompatible = locale === 'zh' ? !containsHan
    : containsHan || (locale === 'es' ? english && !spanish : spanish && !english)
  return incompatible ? (EVENT_COPY[locale] ?? EVENT_COPY.es)![event.kind] : text
}

/** Return one event only when it is an explicitly speakable important event.
 * @param input - untrusted session event candidate.
 * @returns a normalized important voice event, or undefined.
 */
export function sessionEventToVoiceEvent(input: unknown, language = 'es-DO'): VoiceImportantEvent | undefined {
  if (!isRecord(input) || typeof input.type !== 'string' || !isRecord(input.data)) return undefined
  const data = input.data
  const id = stringValue(data.id) ?? stringValue(data.goalId) ?? 'event'
  const revision = stringValue(data.revision) ?? 'current'
  switch (input.type) {
    case 'approval/asked':
      return {
        kind: 'authorization',
        displayOutput: (EVENT_COPY[language.split('-')[0] ?? 'es'] ?? EVENT_COPY.es)!.authorization,
        language,
        dedupeKey: `authorization:${id}`,
      }
    case 'goal/judge': {
      const verdict = data.verdict
      const summary = naturalEventSummary(data.summary)
      const sameLanguage = stringValue(data.language)?.split('-')[0] === language.split('-')[0]
      const localized = EVENT_COPY[language.split('-')[0] ?? 'es'] ?? EVENT_COPY.es
      if (verdict === 'pass') {
        return {
          kind: 'mission-completed',
          displayOutput: sameLanguage && summary !== undefined ? summary : localized!['mission-completed'],
          language,
          dedupeKey: `completed:${id}:${revision}`,
        }
      }
      if (verdict === 'blocked') {
        return {
          kind: 'blocked',
          displayOutput: sameLanguage && summary !== undefined ? summary : localized!.blocked,
          language,
          dedupeKey: `blocked:${id}:${revision}`,
        }
      }
      return undefined
    }
    case 'goal/supervisor':
      if (data.status !== 'blocked' && data.nextAction !== 'blocked') return undefined
      return {
        kind: 'blocked',
        displayOutput: (EVENT_COPY[language.split('-')[0] ?? 'es'] ?? EVENT_COPY.es)!.blocked,
        language,
        dedupeKey: `blocked:${id}:${revision}`,
      }
    default:
      return undefined
  }
}

function naturalEventSummary(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu, ' ')
    .replace(/\b[0-9a-f]{16,}\b/giu, ' ')
    .replace(/\b\d{6,}\b/gu, ' ')
    .replace(/\bneeds? attention\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return text === '' ? undefined : text.slice(0, 320)
}

const CODEX_REALTIME_CONTEXT_MAX_ITEMS = 6
const CODEX_REALTIME_CONTEXT_MAX_CHARS = 6_000
const CODEX_REALTIME_CONTEXT_MAX_ITEM_CHARS = 1_800

/**
 * Project only recent visible user/assistant prose into Codex Realtime V3
 * initialItems. Tool calls, tool results, reasoning, images, files, system
 * context, and plugin injections stay out so voice does not repay the full
 * Phoenix prompt on every activation.
 * @param messages - PHOENIX derived message history, accepted as unknown for a
 *   dependency-light voice package boundary.
 * @returns Oldest-first compact role/text items bounded to a small token proxy.
 */
export function phoenixMessagesToCodexRealtimeInitialItems(
  messages: readonly unknown[],
): CodexRealtimeInitialItem[] {
  const newestFirst: CodexRealtimeInitialItem[] = []
  let remaining = CODEX_REALTIME_CONTEXT_MAX_CHARS

  for (let index = messages.length - 1; index >= 0 && newestFirst.length < CODEX_REALTIME_CONTEXT_MAX_ITEMS && remaining > 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || (message.role !== 'user' && message.role !== 'assistant')
      || !isRecord(message.source)) continue
    if (message.role === 'user' && message.source.kind !== 'user') continue
    if (message.role === 'assistant' && message.source.kind !== 'model') continue
    if (!Array.isArray(message.content)) continue

    const text = message.content
      .filter((block): block is UnknownRecord => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
      .map(block => String(block.text))
      .join('\n')
      .replace(/\s+/gu, ' ')
      .trim()
    if (text === '') continue

    const itemLimit = Math.min(CODEX_REALTIME_CONTEXT_MAX_ITEM_CHARS, remaining)
    const bounded = compactRealtimeContextText(text, itemLimit)
    if (bounded === '') continue
    newestFirst.push({ role: message.role, text: bounded })
    remaining -= bounded.length
  }

  return newestFirst.reverse()
}

function compactRealtimeContextText(text: string, limit: number): string {
  if (limit <= 0) return ''
  if (text.length <= limit) return text
  if (limit < 24) return text.slice(-limit)
  const separator = ' … '
  const content = limit - separator.length
  const head = Math.ceil(content / 2)
  const tail = content - head
  return `${text.slice(0, head)}${separator}${text.slice(-tail)}`
}

/** Provider registry and non-blocking important-event announcement queue. */
export class VoiceRuntime extends TypertRemoteService {
  static Config: z<VoiceRuntimeConfig> = z.object({
    enabled: z.boolean().default(true),
    language: z.string().default('es-DO'),
    maxQueue: z.number().default(3),
    maxChars: z.number().default(480),
    ttsProvider: z.string(),
    sttProvider: z.string(),
    codexRealtime: z.boolean().default(true),
  })

  private readonly config: ResolvedVoiceRuntimeConfig
  private readonly ttsProviders = new Map<string, VoiceTextToSpeechProvider>()
  private readonly sttProviders = new Map<string, VoiceSpeechToTextProvider>()
  private readonly queue: QueuedAnnouncement[] = []
  private readonly pendingKeys = new Set<string>()
  private current: QueuedAnnouncement | undefined
  private draining = false
  private readonly conversationSpeech = new Map<string, ConversationSpeechChannel>()
  private readonly realtimeTranscriptTurns = new Map<string, RealtimeTranscriptTurn>()
  private codexRealtime: CodexRealtimeBridge | undefined

  constructor(ctx: Context, config: VoiceRuntimeConfig = {}) {
    super(ctx, 'voice')
    this.config = {
      enabled: config.enabled ?? true,
      language: config.language?.trim() || 'es-DO',
      maxQueue: positiveInteger(config.maxQueue ?? 3, 'maxQueue'),
      maxChars: positiveInteger(config.maxChars ?? 480, 'maxChars'),
      ...config.ttsProvider?.trim() ? { ttsProvider: config.ttsProvider.trim() } : {},
      ...config.sttProvider?.trim() ? { sttProvider: config.sttProvider.trim() } : {},
      codexRealtime: config.codexRealtime ?? true,
    }
    ctx.on('voice/important', (event) => { void this.announce(event) })
    ctx.on('session/event', (_session, event) => {
      const important = sessionEventToVoiceEvent(event, panelVoiceLanguage(this.ctx, this.config.language))
      if (important !== undefined) void this.announce(important)
    })
    ctx.effect(() => () => { this.stop() }, 'voice queue teardown')
  }

  /**
   * Report whether the local Client can route conversation speech through the
   * deterministic Kokoro -> platform fallback chain.
   * @returns Current conversational voice availability and selected provider.
   */
  @Remote('conversationStatus')
  async conversationStatus(): Promise<VoiceConversationStatus> {
    const provider = this.selectConversationTtsProvider()
    return {
      enabled: this.config.enabled,
      natural: this.config.enabled && provider?.id === 'kokoro',
      ...(provider === undefined ? {} : { provider: provider.id }),
    }
  }

  /**
   * Probe the native Codex realtime sidecar. This is separate from ordinary TTS
   * so non-Codex providers can keep the existing browser/local voice route.
   * @returns Enabled state, sidecar availability and authentication status.
   */
  @Remote('conversationRealtimeStatus')
  async conversationRealtimeStatus(): Promise<VoiceConversationRealtimeStatus> {
    if (!this.config.enabled || !this.config.codexRealtime) {
      return {
        enabled: false,
        available: false,
        authenticated: false,
        provider: 'openai-codex',
        reason: 'disabled',
      }
    }
    const probe = await this.codexRealtimeBridge().probe()
    return {
      enabled: true,
      available: probe.available,
      authenticated: probe.authenticated,
      provider: 'openai-codex',
      ...(probe.reason === undefined ? {} : { reason: probe.reason }),
    }
  }

  /**
   * Negotiate browser WebRTC directly with Codex Realtime through the locally
   * authenticated app-server. No API key is accepted by this path.
   * @param request Browser-owned call identity, model selection and SDP offer.
   * @returns Accepted negotiation with answer SDP, or a classified rejection.
   */
  @Remote('conversationRealtimeStart')
  async conversationRealtimeStart(
    request: VoiceConversationRealtimeStartRequest,
  ): Promise<VoiceConversationRealtimeStartReceipt> {
    if (!this.config.enabled || !this.config.codexRealtime) {
      return { accepted: false, reason: 'disabled' }
    }
    const key = request.key.trim()
    // SDP is a line-oriented protocol. Preserve the browser-generated bytes,
    // including the terminal CRLF required by strict SDP parsers. Trimming the
    // offer here turns a valid Chrome SDP into a truncated payload that Codex
    // rejects with "failed to unmarshal SDP: EOF".
    const offerSdp = request.offerSdp
    const model = request.model?.trim()
    if (key === '' || key.length > 256 || offerSdp.trim() === '' || offerSdp.length > 131_072
      || (model !== undefined && (model === '' || model.length > 128))) {
      return { accepted: false, reason: 'invalid' }
    }
    try {
      const probe = await this.codexRealtimeBridge().probe()
      if (!probe.available || !probe.authenticated) {
        return {
          accepted: false,
          reason: probe.reason ?? (probe.available ? 'codex-login-required' : 'codex-unavailable'),
        }
      }
      // Session history is optional context enrichment for Realtime. Voice must not
      // depend on SessionStore injection order: Cordis explicitly allows ctx.get()
      // for optional/late-bound services, while direct ctx.sessions access throws
      // "cannot get property \"sessions\" without inject" from this plugin fiber.
      const session = this.ctx.get('sessions')?.get(SessionId(key))
      const initialItems = session === undefined
        ? []
        : phoenixMessagesToCodexRealtimeInitialItems(session.deriveMessages())
      const identity = realtimeAssistantIdentity(this.ctx)
      const result = await this.codexRealtimeBridge().start({
        key,
        offerSdp,
        ...(model === undefined ? {} : { model }),
        ...(initialItems.length === 0 ? {} : { initialItems }),
        assistantName: identity.name,
        assistantGender: identity.gender,
        voice: identity.voice,
        onTranscript: (transcript) => {
          this.appendRealtimeTranscript(key, model, transcript)
        },
      })
      return {
        accepted: true,
        threadId: result.threadId,
        answerSdp: result.answerSdp,
      }
    } catch (error) {
      const message = String(error)
      if (/chatgpt login|required|not authenticated|account/i.test(message)) {
        return { accepted: false, reason: 'codex-login-required' }
      }
      if (/not found|enoent|could not start|spawn/i.test(message)) {
        return { accepted: false, reason: 'codex-unavailable' }
      }
      this.ctx.logger('voice').warn(`Codex realtime negotiation failed: ${message}`)
      return {
        accepted: false,
        reason: 'negotiation-failed',
        detail: codexRealtimeFailureDetail(error),
      }
    }
  }

  /** Stop one browser-owned Codex realtime call.
   * @param request Browser-owned call identity to stop.
   * @returns Whether an active call was stopped; invalid or unknown identities return false.
   */
  @Remote('conversationRealtimeStop')
  async conversationRealtimeStop(
    request: VoiceConversationRealtimeStopRequest,
  ): Promise<VoiceConversationRealtimeStopReceipt> {
    const key = request.key.trim()
    if (key === '' || key.length > 256 || this.codexRealtime === undefined) return { stopped: false }
    this.closeRealtimeTranscriptTurn(key, 'interrupted')
    return { stopped: await this.codexRealtime.stop(key).catch(() => false) }
  }

  /**
   * Play one stable semantic segment on the Host without blocking the browser thread.
   * @param request - Message identity, ordering, text, language, and final-segment metadata.
   * @returns Admission/playback receipt for the selected conversation TTS provider.
   */
  @Remote('conversationSpeak')
  async conversationSpeak(request: VoiceConversationSpeakRequest): Promise<VoiceConversationSpeakReceipt> {
    if (!this.config.enabled) return { accepted: false, reason: 'disabled' }
    const providers = this.conversationTtsProviders()
    const provider = providers[0]
    if (provider === undefined) {
      return { accepted: false, reason: 'natural-unavailable' }
    }
    const key = request.key.trim()
    if (key === '' || key.length > 256 || !Number.isSafeInteger(request.sequence) || request.sequence < 0) {
      return { accepted: false, reason: 'invalid', provider: provider.id }
    }
    const text = displayOutputToVoiceText(request.text, Math.min(this.config.maxChars, 360))
    if (text === '') return { accepted: false, reason: 'empty', provider: provider.id }

    let channel = this.conversationSpeech.get(key)
    if (channel === undefined) {
      channel = { lastSequence: -1, controllers: new Set(), tail: Promise.resolve() }
      this.conversationSpeech.set(key, channel)
    }
    if (request.sequence <= channel.lastSequence) {
      return { accepted: false, reason: 'duplicate', provider: provider.id }
    }
    channel.lastSequence = request.sequence
    const controller = new AbortController()
    channel.controllers.add(controller)
    const language = request.language?.trim() || panelVoiceLanguage(this.ctx, this.config.language)
    const final = request.final === true
    const currentChannel = channel
    let spokenProvider = provider.id
    let playbackError: unknown
    const task = channel.tail
      .catch(() => {})
      .then(async () => {
        if (controller.signal.aborted) return
        spokenProvider = await this.speakThroughProviders(
          text,
          language,
          controller.signal,
          providers,
        ) ?? spokenProvider
      })
      .catch((error: unknown) => {
        playbackError = error
        if (!controller.signal.aborted) {
          this.ctx.logger('voice').warn(`conversation voice failed: ${String(error)}`)
        }
      })
      .finally(() => {
        currentChannel.controllers.delete(controller)
        if (final && currentChannel.controllers.size === 0 && this.conversationSpeech.get(key) === currentChannel) {
          this.conversationSpeech.delete(key)
        }
      })
    channel.tail = task
    // Awaiting here keeps the RPC itself open until this segment finishes, but
    // the Client never awaits it on its render path. The completion signal lets
    // hands-free mode return from "speaking" to "listening" truthfully.
    await task
    if (playbackError !== undefined || controller.signal.aborted) {
      return { accepted: false, reason: 'natural-unavailable', provider: spokenProvider }
    }
    return { accepted: true, provider: spokenProvider }
  }

  /**
   * Abort queued or active speech for one growing assistant response.
   * @param request - Stable assistant-response key whose speech should be cancelled.
   * @returns Number of in-flight segment controllers aborted for the response.
   */
  @Remote('conversationCancel')
  async conversationCancel(request: VoiceConversationCancelRequest): Promise<VoiceConversationCancelReceipt> {
    const key = request.key.trim()
    const channel = this.conversationSpeech.get(key)
    if (channel === undefined) return { cancelled: 0 }
    this.conversationSpeech.delete(key)
    const controllers = [...channel.controllers]
    for (const controller of controllers) controller.abort('conversation speech cancelled')
    return { cancelled: controllers.length }
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
    const language = panelVoiceLanguage(this.ctx, this.config.language)
    const text = displayOutputToVoiceText(localizedImportantSpeech(event, language), this.config.maxChars)
    if (text === '') return { id, accepted: false, reason: 'empty' }
    // Never mix the browser/system TTS voice into an active native Codex call.
    // The browser realtime surface (or the finalized harness answer) owns these
    // audible notifications while the authenticated Codex session is alive.
    if (this.codexRealtime?.hasActiveSession() === true) {
      return { id, accepted: false, reason: 'native-realtime' }
    }
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
    for (const channel of this.conversationSpeech.values()) {
      for (const controller of channel.controllers) controller.abort('voice stopped')
    }
    this.conversationSpeech.clear()
    for (const key of [...this.realtimeTranscriptTurns.keys()]) {
      this.closeRealtimeTranscriptTurn(key, 'interrupted')
    }
    this.codexRealtime?.close()
    this.codexRealtime = undefined
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
      speaking: this.current !== undefined
        || [...this.conversationSpeech.values()].some(channel => channel.controllers.size > 0),
      ...ttsProvider === undefined ? {} : { ttsProvider: ttsProvider.id },
      ...sttProvider === undefined ? {} : { sttProvider: sttProvider.id },
    }
  }

  private appendRealtimeTranscript(
    key: string,
    model: string | undefined,
    transcript: CodexRealtimeTranscript,
  ): void {
    const text = transcript.text.trim()
    if (text === '') return

    // Realtime voice is an input/output transport, not a second agent loop.
    // Route final human speech through the exact live Phoenix Agent so the
    // normal harness owns planning, tools, hardness, durable events, and the
    // assistant response. Ignore the realtime model's independent assistant
    // transcript in this case; the live Agent is the single source of truth.
    const sessionId = SessionId(key)
    const agents = this.ctx.get('agents') as unknown as {
      get(id: SessionId): { followup(message: ReturnType<typeof createUserMessage>): void } | undefined
    } | undefined
    const agent = agents?.get(sessionId)
    if (agent !== undefined) {
      // Browser PHOENIX sessions admit the finalized Live transcript through
      // the ordinary composer/session prompt path. That path renders the user
      // message immediately and then wakes this same live Agent. Keep the
      // app-server notification as compatibility input only for standalone
      // voice compositions so one spoken turn cannot be dispatched twice.
      return
    }

    // Standalone voice compositions can intentionally omit an Agent registry.
    // Keep their legacy transcript journal so the package still degrades to a
    // useful conversation record instead of dropping speech.
    const store = this.ctx.get('sessions')
    const session = store?.get(sessionId)
    if (session === undefined) return

    if (transcript.role === 'user') {
      this.closeRealtimeTranscriptTurn(key, 'user')
      const turn = nextRealtimeTurn(session.events)
      const step = 1
      session.append('turn/start', { turn })
      session.append('user/message', createUserMessage({
        source: { kind: 'user' },
        content: [{ type: 'text', text }],
      }), { surfaceOp: 'append' })
      session.append('step/start', { turn, step })
      this.realtimeTranscriptTurns.set(key, { turn, step })
      void store?.flush(session).catch((error: unknown) => {
        this.ctx.logger('voice').warn(`realtime user transcript flush failed: ${String(error)}`)
      })
      return
    }

    let state = this.realtimeTranscriptTurns.get(key)
    if (state === undefined) {
      state = { turn: nextRealtimeTurn(session.events), step: 1 }
      session.append('turn/start', { turn: state.turn })
      session.append('step/start', state)
      this.realtimeTranscriptTurns.set(key, state)
    }
    session.append('assistant/message', {
      turn: state.turn,
      step: state.step,
      message: createAssistantMessage({
        source: {
          provider: 'openai-codex',
          model: model?.trim() || 'codex-realtime',
        },
        content: [{ type: 'text', text }],
      }),
    }, { surfaceOp: 'append' })
    session.append('step/end', state)
    session.append('turn/end', { turn: state.turn, reason: { kind: 'completed' } })
    this.realtimeTranscriptTurns.delete(key)
    void store?.flush(session).catch((error: unknown) => {
      this.ctx.logger('voice').warn(`realtime assistant transcript flush failed: ${String(error)}`)
    })
  }

  private closeRealtimeTranscriptTurn(key: string, reason: 'user' | 'interrupted'): void {
    const state = this.realtimeTranscriptTurns.get(key)
    if (state === undefined) return
    const store = this.ctx.get('sessions')
    const session = store?.get(SessionId(key))
    this.realtimeTranscriptTurns.delete(key)
    if (session === undefined) return
    session.append('step/end', state)
    session.append('turn/end', {
      turn: state.turn,
      reason: reason === 'user'
        ? { kind: 'aborted', reason: { kind: 'user' } }
        : { kind: 'interrupted' },
    })
    void store?.flush(session).catch((error: unknown) => {
      this.ctx.logger('voice').warn(`realtime transcript close flush failed: ${String(error)}`)
    })
  }

  private codexRealtimeBridge(): CodexRealtimeBridge {
    this.codexRealtime ??= new CodexRealtimeBridge()
    return this.codexRealtime
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

  private conversationTtsProviders(): VoiceTextToSpeechProvider[] {
    // Hands-free fallback is intentionally deterministic: Codex Live is owned
    // by the Realtime bridge; when it is unavailable the Host speaks through
    // Kokoro first, then the platform-native engine. Other optional neural
    // engines remain available for non-conversation announcements only.
    const ids = ['kokoro', 'system'] as const
    const providers: VoiceTextToSpeechProvider[] = []
    for (const id of ids) {
      const provider = this.ttsProviders.get(id)
      if (provider?.available() === true) providers.push(provider)
    }
    return providers
  }

  private selectConversationTtsProvider(): VoiceTextToSpeechProvider | undefined {
    return this.conversationTtsProviders()[0]
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
        const providers = orderedProviders(this.ttsProviders, this.config.ttsProvider)
        if (providers.length === 0) continue
        this.current = item
        try {
          await this.speakThroughProviders(
            item.text,
            panelVoiceLanguage(this.ctx, this.config.language),
            item.controller.signal,
            providers,
          )
        } finally {
          this.current = undefined
        }
      }
    } finally {
      this.draining = false
    }
  }

  private async speakThroughProviders(
    text: string,
    language: string,
    signal: AbortSignal,
    candidates = orderedProviders(this.ttsProviders, this.config.ttsProvider),
  ): Promise<string | undefined> {
    let lastError: unknown
    for (const provider of candidates) {
      if (signal.aborted) return undefined
      try {
        await provider.speak({ text, language, signal })
        return provider.id
      } catch (error) {
        lastError = error
        if (signal.aborted) return undefined
        this.ctx.logger('voice').warn(
          `voice provider "${provider.id}" failed; trying fallback: ${String(error)}`,
        )
      }
    }
    if (lastError !== undefined) throw lastError
    return undefined
  }
}

function realtimeAssistantIdentity(ctx: Context): RealtimeAssistantIdentity {
  const service = ctx.get('userProfile') as {
    getAssistantIdentity?: () => { name?: unknown; gender?: unknown }
  } | undefined
  const configured = service?.getAssistantIdentity?.()
  const name = typeof configured?.name === 'string' && configured.name.trim() !== ''
    ? configured.name.trim().slice(0, 120)
    : 'KIRA'
  const gender: RealtimeAssistantGender = configured?.gender === 'masculine'
    || configured?.gender === 'neutral'
    || configured?.gender === 'feminine'
    ? configured.gender
    : 'feminine'
  return {
    name,
    gender,
    // Codex V1/V3 currently share this voice family. Pinning a voice prevents
    // provider defaults from silently changing the configured presentation.
    voice: gender === 'feminine' ? 'juniper' : gender === 'masculine' ? 'cove' : 'breeze',
  }
}

function nextRealtimeTurn(events: readonly { readonly type: string; readonly data: unknown }[]): number {
  let maximum = 0
  for (const event of events) {
    if (typeof event.data !== 'object' || event.data === null || !('turn' in event.data)) continue
    const turn = (event.data as { readonly turn?: unknown }).turn
    if (typeof turn === 'number' && Number.isSafeInteger(turn) && turn > maximum) maximum = turn
  }
  return maximum + 1
}

function codexRealtimeFailureDetail(value: unknown): string {
  const message = (value instanceof Error ? value.message : String(value)).trim()
  const redacted = message
    .replace(/\b(?:sk|sess|token)-[A-Za-z0-9._-]{8,}\b/gu, '[redacted]')
    .replace(/Bearer\s+[a-z0-9._~+\/-]+=*/giu, 'Bearer [redacted]')
  return (redacted === '' ? 'Codex realtime negotiation failed' : redacted).slice(0, 1_024)
}

function orderedProviders<P extends { readonly id: string; readonly priority: number; available(): boolean }>(
  providers: ReadonlyMap<string, P>,
  configuredId: string | undefined,
): P[] {
  const available = [...providers.values()]
    .filter(provider => provider.available())
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
  if (configuredId === undefined) return available
  const configured = available.find(provider => provider.id === configuredId)
  if (configured === undefined) return available
  return [configured, ...available.filter(provider => provider !== configured)]
}

function selectProvider<P extends { readonly id: string; readonly priority: number; available(): boolean }>(
  providers: ReadonlyMap<string, P>,
  configuredId: string | undefined,
): P | undefined {
  return orderedProviders(providers, configuredId)[0]
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
