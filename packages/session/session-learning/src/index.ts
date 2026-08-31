/**
 * Persistent learning memory for PHOENIX. The service observes durable session
 * events, records bounded lessons with provenance, and exposes explicit search
 * and forgetting operations. It does not alter the system prompt or grant
 * permissions on its own.
 *
 * @module @phoenix-ai/dsh-session-learning
 */

import { Context, Service } from '@phoenix-ai/cordis'
import z from '@phoenix-ai/schemastery'
import type {} from '@phoenix-ai/dsh-agent'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import { MemoryLedger } from './ledger.ts'
import type { MemoryId, MemoryKind, MemoryRecord, MemoryRecordInput } from './ledger.ts'

export { MemoryLedger } from './ledger.ts'
export type { MemoryId, MemoryKind, MemoryRecord, MemoryRecordInput } from './ledger.ts'

declare module '@phoenix-ai/cordis' {
  interface Context {
    learningMemory: LearningMemoryService
  }
}

/** Plugin configuration for the owner-only learning ledger. */
export interface Config {
  /** Absolute or process-relative JSONL path owned by Phoenix. */
  path: string
  /** Maximum active records retained by the ledger. */
  maxRecords?: number
}

/** Config schema; the path is explicit so profiles cannot scatter memory files. */
export const Config: z<Config> = z.object({
  path: z.string().required(),
  maxRecords: z.number().step(1).min(1).default(10_000),
})

const DEFAULT_MAX_RECORDS = 10_000
const MAX_SUMMARY_CHARS = 4_096

/**
 * Event-backed memory service. Every source event is deduplicated by the
 * ledger, so hot reload and resumed sessions do not multiply memories.
 */
export class LearningMemoryService extends Service {
  static inject = ['sessions']
  static Config = Config

  private readonly ledger: MemoryLedger
  private operationTail: Promise<void> = Promise.resolve()

  /** @param ctx - Host context containing the live session store. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'learningMemory')
    this.ledger = new MemoryLedger(config.path, config.maxRecords ?? DEFAULT_MAX_RECORDS)
  }

  /** Load memory and install the durable session-event observer. */
  protected async [Service.init](): Promise<void> {
    await this.ledger.load()
    for (const session of this.ctx.sessions.list()) this.observeSession(session)
    this.ctx.on('session/created', (session) => { this.observeSession(session) })
    this.ctx.on('session/event', (session, event) => { void this.queue(() => this.observeEvent(session, event)) })
    this.ctx.on('agent/error', ({ agent, turn, step, error }) => {
      void this.queue(() => this.observeAgentError(agent.session, turn, step, error))
    })
    this.ctx.effect(() => async () => this.ready(), 'learningMemory.flush')
  }

  /** Wait until all queued learning writes have reached the ledger. */
  async ready(): Promise<void> {
    await this.operationTail
  }

  /**
   * Search active memories by words in their summary or provenance.
   * @param query - Words to match against memory text.
   * @param limit - Maximum number of records to return.
   * @returns Matching active memory records.
   */
  search(query: string = '', limit: number = 50): Promise<MemoryRecord[]> {
    return this.ledger.search(query, limit)
  }

  /**
   * Read newest active records for bounded automatic model recall.
   * @param limit - Maximum number of records to return.
   * @returns Newest active memory records.
   */
  recent(limit: number = 20): MemoryRecord[] {
    return this.ledger.recent(limit)
  }

  /**
   * Read bounded automatic continuity context, prioritizing durable memories.
   * @param limit - Maximum number of records to return.
   * @returns Durable high-confidence memories followed by recent evidence.
   */
  recall(limit: number = 20): MemoryRecord[] {
    return this.ledger.recall(limit)
  }

  /**
   * Store an explicit, bounded lesson supplied by the model or user workflow.
   * @param input - Memory record to persist.
   * @returns The persisted memory record.
   */
  remember(input: MemoryRecordInput): Promise<MemoryRecord> {
    return this.queue(() => this.ledger.remember({
      ...input,
      summary: sanitize(input.summary),
      sourceEventType: sanitize(input.sourceEventType),
    }))
  }

  /**
   * Forget one memory while preserving an auditable tombstone.
   * @param id - Memory identity to forget.
   */
  forget(id: MemoryId): Promise<void> {
    return this.queue(() => this.ledger.forget(id))
  }

  /** Return the underlying path for diagnostics and backup tooling. */
  get storagePath(): string {
    return this.ledger.path
  }

  private observeSession(session: Session): void {
    for (const event of session.events) void this.queue(() => this.observeEvent(session, event))
  }

  private observeEvent(session: Session, event: SessionEvent): Promise<void> {
    const observation = observationFor(session, event)
    return observation === undefined ? Promise.resolve() : this.ledger.remember(observation)
      .then(() => undefined)
      .catch((error: unknown) => {
        this.ctx.logger.warn(`learning-memory: ignored event ${event.type} in ${String(session.id)}: ${String(error)}`)
      })
  }

  private observeAgentError(session: Session, turn: number, step: number, error: unknown): Promise<void> {
    return this.ledger.remember({
      sessionId: String(session.id),
      eventSeq: session.seq,
      kind: 'error',
      summary: sanitize(`Agent failed at turn ${String(turn)}, step ${String(step)}: ${errorText(error)}`),
      sourceEventType: 'agent/error',
      confidence: 0.95,
      occurredAt: Date.now(),
    }).then(() => undefined).catch((failure: unknown) => {
      this.ctx.logger.warn(`learning-memory: ignored agent error in ${String(session.id)}: ${String(failure)}`)
    })
  }

  private queue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationTail.then(operation)
    this.operationTail = next.then(() => undefined, () => undefined)
    return next
  }
}

interface Observation {
  sessionId: string
  eventSeq: number
  kind: MemoryKind
  summary: string
  sourceEventType: string
  confidence: number
  occurredAt: number
}

function observationFor(session: Session, event: SessionEvent): Observation | undefined {
  switch (event.type) {
    case 'user/message': {
      const text = messageText(event.data)
      if (text === undefined) return undefined
      if (isDurableUserSignal(text)) {
        return observation(session, event, 'preference', `User preference: ${text}`, 0.95)
      }
      return observation(session, event, 'interaction', `User interaction: ${text}`, 0.7)
    }
    case 'turn/end': {
      const reason = event.data.reason
      if (reason.kind === 'completed') {
        return observation(session, event, 'success', `Task completed in session ${String(session.id)}`, 0.85)
      }
      if (reason.kind === 'error') {
        const detail = errorText(reason.error)
        return observation(session, event, 'error', `Task failed: ${detail}`, 0.9)
      }
      return undefined
    }
    case 'tool/result': {
      const result = event.data.message.content[0]
      if (result.isError === true) {
        return observation(session, event, 'error', `Tool failed: ${toolResultText(event.data.message)}`, 0.9)
      }
      return observation(session, event, 'success', `Tool completed: ${toolResultText(event.data.message)}`, 0.8)
    }
    default:
      return undefined
  }
}

/** Detect explicit user signals that should survive the current interaction. */
const DURABLE_USER_SIGNAL_PATTERNS = [
  /\b(?:esto es importante|this is important|recuerda(?: esto)?|remember(?: this)?|no olvides|don't forget)\b/iu,
  /\b(?:i prefer|prefiero|siempre|always|nunca|never)\b/iu,
  /\b(?:mi nombre es|my name is|soy|i am|i'm)\b/iu,
  /\b(?:vivo en|i live in|trabajo en|i work (?:on|at)|estoy trabajando en|i'm working on)\b/iu,
] as const

function isDurableUserSignal(text: string): boolean {
  return DURABLE_USER_SIGNAL_PATTERNS.some(pattern => pattern.test(text))
}

function observation(session: Session, event: SessionEvent, kind: MemoryKind, summary: string, confidence: number): Observation {
  return {
    sessionId: String(session.id),
    eventSeq: event.seq,
    kind,
    summary: sanitize(summary),
    sourceEventType: event.type,
    confidence,
    occurredAt: event.time,
  }
}

function messageText(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('content' in value)) return undefined
  const content = (value as { content?: unknown }).content
  if (!Array.isArray(content)) return undefined
  const parts = content.flatMap((part: unknown) => {
    if (typeof part !== 'object' || part === null || !('text' in part)) return []
    const text = (part as { text?: unknown }).text
    return typeof text === 'string' ? [text] : []
  })
  const text = parts.join(' ').trim()
  return text === '' ? undefined : text
}

function toolResultText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null || !('content' in value)) return 'unknown tool result'
  const content = (value as { content?: unknown }).content
  if (!Array.isArray(content)) return typeof content === 'string' ? content : 'unknown tool result'
  const parts = content.flatMap((part: unknown) => {
    if (typeof part !== 'object' || part === null) return []
    if ('text' in part && typeof (part as { text?: unknown }).text === 'string') {
      return [(part as { text: string }).text]
    }
    if ('content' in part) return [toolResultText(part)]
    return []
  })
  const result = parts.join(' ').trim()
  return result === '' ? 'unknown tool result' : result
}

function errorText(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string' && message.trim() !== '') return message
  }
  return String(value)
}

function sanitize(value: string): string {
  return value
    .replace(/(api[_-]?key|token|password|secret)\s*[:=]\s*\S+/giu, '$1=[redacted]')
    .trim()
    .slice(0, MAX_SUMMARY_CHARS)
}

export default LearningMemoryService
