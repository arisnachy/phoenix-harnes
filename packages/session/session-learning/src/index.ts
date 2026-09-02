/**
 * Persistent learning memory for PHOENIX. The service observes durable session
 * events, records bounded lessons with provenance, and exposes explicit search
 * and forgetting operations. It does not alter the system prompt or grant
 * permissions on its own.
 *
 * @module @phoenix-ai/dsh-session-learning
 */

import { Context, Service } from '@phoenix-ai/cordis'
import { basename } from 'node:path'
import z from '@phoenix-ai/schemastery'
import type {} from '@phoenix-ai/dsh-agent'
import { SessionId } from '@phoenix-ai/dsh-session'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import { CognitiveMemoryLedger } from './cognitive.ts'
import type { CognitiveMemoryEntity, CognitiveMemoryInput, CognitiveMemoryLayer, CognitiveMemoryKind, CognitiveMemoryQuery, CognitiveMemoryRecord, CognitiveMemoryHit } from './cognitive.ts'
import { MemoryLedger } from './ledger.ts'
import type { MemoryId, MemoryKind, MemoryRecord, MemoryRecordInput } from './ledger.ts'

export { MemoryLedger } from './ledger.ts'
export type { MemoryId, MemoryKind, MemoryRecord, MemoryRecordInput } from './ledger.ts'
export { CognitiveMemoryLedger, normalize } from './cognitive.ts'
export type {
  CognitiveMemoryEntity,
  CognitiveMemoryHit,
  CognitiveMemoryInput,
  CognitiveMemoryKind,
  CognitiveMemoryLayer,
  CognitiveMemoryProvenance,
  CognitiveMemoryQuery,
  CognitiveMemoryRecord,
  CognitiveMemoryRelation,
  CognitiveMemoryStatus,
} from './cognitive.ts'

declare module '@phoenix-ai/cordis' {
  interface Context {
    learningMemory: LearningMemoryService
  }
}

/** Plugin configuration for the owner-only learning ledger. */
export interface Config {
  /** Absolute or process-relative JSONL path owned by Phoenix. */
  path: string
  /** Compatibility limit for bounded legacy queries; canonical records are never pruned. */
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
  private readonly cognitive: CognitiveMemoryLedger
  private operationTail: Promise<void> = Promise.resolve()
  private currentProject: string | undefined
  private currentSession: string | undefined
  private currentSessionCreatedAt = -1

  /** @param ctx - Host context containing the live session store. */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'learningMemory')
    this.ledger = new MemoryLedger(config.path, config.maxRecords ?? DEFAULT_MAX_RECORDS)
    this.cognitive = new CognitiveMemoryLedger(cognitivePath(config.path))
  }

  /** Load memory without holding Phoenix boot on large historical ledgers. */
  protected async [Service.init](): Promise<void> {
    for (const session of this.ctx.sessions.list()) this.setCurrentSession(session)

    const loading = Promise.all([this.ledger.load(), this.cognitive.load()])
      .then(() => undefined)
      .catch((error: unknown) => {
        this.ctx.logger.warn(`learning-memory: startup load degraded but Phoenix will remain available: ${String(error)}`)
      })
    this.operationTail = loading

    this.ctx.on('session/created', (session) => { this.observeSession(session) })
    this.ctx.on('session/event', (session, event) => { void this.queue(() => this.observeEvent(session, event)) })
    this.ctx.on('agent/error', ({ agent, turn, step, error }) => {
      void this.queue(() => this.observeAgentError(agent.session, turn, step, error))
    })
    this.ctx.effect(() => async () => this.ready(), 'learningMemory.flush')

    // Historical replay remains durable and idempotent, but it is deliberately
    // scheduled after loading instead of blocking Service.init. This keeps the
    // web/client bootstrap responsive even with a very large memory archive.
    void loading.then(() => {
      for (const session of this.ctx.sessions.list()) this.observeSession(session)
    })
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
   * Search cognitive memory with project, temporal, entity, and layer filters.
   * @param query - Words to match against normalized memory content.
   * @param limit - Maximum number of ranked hits.
   * @param filters - Optional metadata and lifecycle filters.
   * @returns Ranked cognitive memory hits with explainable reasons.
   */
  searchCognitive(query: string = '', limit: number = 50, filters: Omit<CognitiveMemoryQuery, 'query' | 'limit'> = {}): CognitiveMemoryHit[] {
    const project = filters.projectId ?? this.currentProject
    return this.cognitive.search({
      ...filters,
      ...project === undefined ? {} : { projectId: project },
      query,
      limit,
    })
  }

  /**
   * Read bounded, project-scoped cognitive context for automatic recall.
   * @param query - Optional query and filter set.
   * @returns Ranked active cognitive memory hits.
   */
  recallCognitive(query: Omit<CognitiveMemoryQuery, 'limit'> & { limit?: number } = {}): CognitiveMemoryHit[] {
    const project = query.projectId ?? this.currentProject
    return this.cognitive.search({
      ...query,
      ...project === undefined ? {} : { projectId: project },
      limit: query.limit ?? 20,
    })
  }

  /**
   * Read a chronological cognitive timeline, retaining superseded history when requested.
   * @param query - Project, session, time, and history filters.
   * @returns Cognitive records ordered by source occurrence.
   */
  timeline(query: Pick<CognitiveMemoryQuery, 'projectId' | 'sessionId' | 'from' | 'to' | 'includeHistory'> = {}): CognitiveMemoryRecord[] {
    const project = query.projectId ?? this.currentProject
    return this.cognitive.timeline({ ...query, ...project === undefined ? {} : { projectId: project } })
  }

  /**
   * Read the latest working-memory records for the current project.
   * @param limit - Maximum number of records.
   * @returns Active working-memory records.
   */
  workingMemory(limit: number = 20): CognitiveMemoryRecord[] {
    return this.cognitive.working(this.currentProject, this.currentSession, limit)
  }

  /**
   * Return all canonical cognitive records for diagnostics and audit.
   * @returns All records, including explicit forget tombstone state.
   */
  allCognitiveRecords(): CognitiveMemoryRecord[] {
    return this.cognitive.allRecords()
  }

  /**
   * Read the project used to isolate automatic model recall.
   * @returns The current project identifier, when the active session has one.
   */
  currentProjectId(): string | undefined {
    return this.currentProject
  }

  /**
   * Store an explicit, bounded lesson supplied by the model or user workflow.
   * @param input - Memory record to persist.
   * @returns The persisted memory record.
   */
  remember(input: MemoryRecordInput): Promise<MemoryRecord> {
    return this.queue(async () => {
      const safeInput = {
        ...input,
        summary: sanitize(input.summary),
        sourceEventType: sanitize(input.sourceEventType),
      }
      const record = await this.ledger.remember(safeInput)
      await this.cognitive.remember(explicitCognitiveInput(safeInput, this.projectForSession(input.sessionId)))
      return record
    })
  }

  /**
   * Store an explicit cognitive record for a verified lesson or user preference.
   * @param input - Redacted cognitive memory input.
   * @returns The persisted cognitive record.
   */
  rememberCognitive(input: CognitiveMemoryInput): Promise<CognitiveMemoryRecord> {
    return this.queue(() => this.cognitive.remember({
      ...input,
      content: sanitize(input.content),
      summary: sanitize(input.summary),
      sourceEventType: sanitize(input.sourceEventType),
      ...input.value === undefined ? {} : { value: sanitize(input.value) },
    }))
  }

  /**
   * Forget one memory while preserving an auditable tombstone.
   * @param id - Memory identity to forget.
   */
  forget(id: MemoryId): Promise<void> {
    return this.queue(() => this.ledger.forget(id))
  }

  /**
   * Forget a cognitive record only when an explicit caller requests it.
   * @param id - Cognitive memory identity to tombstone.
   */
  forgetCognitive(id: MemoryId): Promise<void> {
    return this.queue(() => this.cognitive.forget(id))
  }

  /** Return the underlying path for diagnostics and backup tooling. */
  get storagePath(): string {
    return this.ledger.path
  }

  /** Return the append-only cognitive ledger path for backup and diagnostics. */
  get cognitiveStoragePath(): string {
    return this.cognitive.path
  }

  private observeSession(session: Session): void {
    this.setCurrentSession(session)
    for (const event of session.events) void this.queue(() => this.observeEvent(session, event))
  }

  private observeEvent(session: Session, event: SessionEvent): Promise<void> {
    this.setCurrentSession(session)
    const observation = observationFor(session, event)
    const cognitiveObservation = cognitiveObservationFor(session, event)
    return Promise.all([
      this.cognitive.remember(cognitiveObservation),
      ...observation === undefined ? [] : [this.ledger.remember(observation)],
    ]).then(() => undefined).catch((error: unknown) => {
      this.ctx.logger.warn(`learning-memory: ignored event ${event.type} in ${String(session.id)}: ${String(error)}`)
    })
  }

  private observeAgentError(session: Session, turn: number, step: number, error: unknown): Promise<void> {
    const safeError = sanitize(`Agent failed at turn ${String(turn)}, step ${String(step)}: ${errorText(error)}`)
    const projectId = this.projectForSession(String(session.id))
    const cognitiveError: CognitiveMemoryInput = {
      sessionId: String(session.id),
      eventSeq: session.seq,
      kind: 'error',
      layers: ['autobiographical', 'working', 'episodic', 'procedural', 'temporal'],
      content: safeError,
      summary: safeError,
      sourceEventType: 'agent/error',
      occurredAt: Date.now(),
      confidence: 0.95,
      importance: 0.9,
      ...projectId === undefined ? {} : { projectId },
    }
    return Promise.all([
      this.ledger.remember({
        sessionId: String(session.id),
        eventSeq: session.seq,
        kind: 'error',
        summary: safeError,
        sourceEventType: 'agent/error',
        confidence: 0.95,
        occurredAt: Date.now(),
      }),
      this.cognitive.remember(cognitiveError),
    ]).then(() => undefined).catch((failure: unknown) => {
      this.ctx.logger.warn(`learning-memory: ignored agent error in ${String(session.id)}: ${String(failure)}`)
    })
  }

  private setCurrentSession(session: Session): void {
    if (session.header.createdAt < this.currentSessionCreatedAt) return
    this.currentSession = String(session.id)
    this.currentProject = projectIdFor(session)
    this.currentSessionCreatedAt = session.header.createdAt
  }

  private projectForSession(sessionId: string): string | undefined {
    const session = this.ctx.sessions.get(SessionId(sessionId))
    return session === undefined
      ? sessionId === this.currentSession ? this.currentProject : undefined
      : projectIdFor(session)
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

function cognitiveObservationFor(session: Session, event: SessionEvent): CognitiveMemoryInput {
  const content = eventText(event)
  const durable = durableFact(content)
  const projectId = projectIdFor(session)
  const entities = entitiesFor(content, projectId, event.type)
  const error = isErrorEvent(event, content)
  const success = isSuccessEvent(event)
  const prospective = /\b(?:goal|mission|pending|blocked|blocker|unfinished|follow[- ]?up|pendiente|misión|bloqueo)\b/iu.test(content)
  const procedural = event.type.startsWith('tool/') || error || /\b(?:strategy|workflow|skill|estrategia|flujo|habilidad)\b/iu.test(content)
  const layers: CognitiveMemoryLayer[] = ['autobiographical', 'working', 'episodic', 'temporal']
  if (durable !== undefined) layers.push('semantic')
  if (procedural) layers.push('procedural')
  if (prospective) layers.push('prospective')
  if (entities.length > 0) layers.push('associative')
  const kind: CognitiveMemoryKind = durable !== undefined
    ? 'preference'
    : prospective ? 'pending'
      : error ? 'error'
        : success ? 'success'
          : event.type === 'user/message' || event.type === 'assistant/message' ? 'conversation' : 'event'
  const safeContent = sanitize(content)
  return {
    sessionId: String(session.id),
    eventSeq: event.seq,
    kind,
    layers: [...new Set(layers)],
    content: safeContent,
    summary: sanitize(`${event.type}: ${safeContent}`),
    sourceEventType: event.type,
    occurredAt: event.time,
    ...projectId === undefined ? {} : { projectId },
    ...durable === undefined ? {} : { subject: durable.subject, value: durable.value },
    entities,
    confidence: durable === undefined ? error ? 0.9 : 0.7 : 0.95,
    importance: durable === undefined ? prospective || error ? 0.9 : success ? 0.65 : 0.5 : 0.95,
  }
}

function explicitCognitiveInput(input: MemoryRecordInput, projectId: string | undefined): CognitiveMemoryInput {
  const entities = entitiesFor(input.summary, projectId, input.sourceEventType)
  const layers: CognitiveMemoryLayer[] = ['autobiographical', 'semantic', 'temporal']
  if (input.kind === 'lesson' || input.kind === 'skill') layers.push('procedural')
  if (entities.length > 0) layers.push('associative')
  return {
    sessionId: input.sessionId,
    eventSeq: input.eventSeq,
    kind: input.kind,
    layers,
    content: sanitize(input.summary),
    summary: sanitize(input.summary),
    sourceEventType: sanitize(input.sourceEventType),
    occurredAt: input.occurredAt,
    ...projectId === undefined ? {} : { projectId },
    entities,
    confidence: input.confidence,
    importance: input.confidence,
  }
}

function eventText(event: SessionEvent): string {
  switch (event.type) {
    case 'user/message':
    case 'assistant/message': return messageText(event.data) ?? event.type
    case 'tool/result': return toolResultText(event.data.message)
    case 'tool/call': return sanitize(`${event.data.name}: ${event.data.arguments}`)
    case 'turn/end': return event.data.reason.kind === 'error' ? `turn failed: ${errorText(event.data.reason.error)}` : `turn ${event.data.reason.kind}`
    default: return safeJsonText(event.data) || event.type
  }
}

function safeJsonText(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return typeof text === 'string' ? text.slice(0, MAX_SUMMARY_CHARS) : ''
  } catch {
    return ''
  }
}

function isErrorEvent(event: SessionEvent, content: string): boolean {
  if (event.type === 'turn/end') return event.data.reason.kind === 'error'
  if (event.type === 'tool/result') return event.data.message.content[0].isError === true
  return /\b(?:error|failed|failure|timeout|timed out|falló|fallido|bloqueado)\b/iu.test(content)
}

function isSuccessEvent(event: SessionEvent): boolean {
  if (event.type === 'turn/end') return event.data.reason.kind === 'completed'
  return event.type === 'tool/result' && event.data.message.content[0].isError !== true
}

function durableFact(text: string): { subject: string; value: string } | undefined {
  const name = text.match(/\b(?:mi nombre es|my name is)\s+([\p{L}][\p{L}'-]{1,80})/iu)
  if (name?.[1] !== undefined) return { subject: 'user.identity.name', value: name[1] }
  const style = text.match(/\b(?:prefiero|i prefer|quiero respuestas?)\s+(?:(?:respuestas?|answers?)\s+)?([^.!?\n]{2,160})/iu)
  if (style?.[1] !== undefined) {
    const value = /\b(?:concise|short|breve|corto|corta)\b/iu.test(style[1])
      ? 'short'
      : /\b(?:detailed|long|detallad[oa]|extens[oa])\b/iu.test(style[1]) ? 'long' : style[1].trim()
    return { subject: 'user.preference.response_style', value }
  }
  const mentionsSandbox = /\b(?:sandbox|código|code)\b/iu.test(text)
  const signalsImportance = /\b(?:siempre|always|nunca|never|importante|important|recuerda|remember)\b/iu.test(text)
  if (mentionsSandbox && signalsImportance) {
    return { subject: 'user.preference.sandbox', value: text.slice(0, 240) }
  }
  if (isDurableUserSignal(text)) return { subject: 'user.preference.general', value: text.slice(0, 240) }
  return undefined
}

function projectIdFor(session: Session): string | undefined {
  const cwd = session.header.cwd
  if (cwd !== undefined) {
    const project = basename(cwd).trim()
    if (project !== '') return project.slice(0, 256)
  }
  return session.header.agentPreset?.trim().slice(0, 256) || undefined
}

function entitiesFor(text: string, projectId: string | undefined, sourceEventType: string): CognitiveMemoryEntity[] {
  const entities: CognitiveMemoryEntity[] = []
  const add = (type: CognitiveMemoryEntity['type'], value: string): void => {
    const normalized = value.normalize('NFKD').toLocaleLowerCase().replace(/\p{Diacritic}/gu, '').trim()
    if (normalized.length < 2 || entities.some(entity => entity.type === type && entity.normalized === normalized)) return
    entities.push({ type, value: value.slice(0, 160), normalized })
  }
  if (projectId !== undefined) add('project', projectId)
  add('event', sourceEventType)
  for (const match of text.matchAll(/(?:[A-Za-z]:[\\/][^\s"']+|[\w./-]+\.(?:ts|tsx|js|jsx|json|md|py|html|css|yml|yaml|txt|pdf))/gu)) {
    add('file', basename(match[0]))
  }
  for (const match of text.matchAll(/\b(?:gpt[-\w.]*|claude[-\w.]*|codex|luna|chatgpt|openclaw)\b/giu)) add('model', match[0])
  for (const token of tokenizeForEntities(text).slice(0, 12)) add('concept', token)
  return entities.slice(0, 32)
}

function tokenizeForEntities(value: string): string[] {
  const stop = new Set(['this', 'that', 'with', 'from', 'para', 'como', 'when', 'when', 'user', 'event', 'the', 'and', 'que', 'una', 'los', 'las'])
  return [...new Set((value.normalize('NFKD').toLocaleLowerCase().replace(/\p{Diacritic}/gu, '').match(/[\p{L}\p{N}_-]{4,}/gu) ?? []).filter(token => !stop.has(token)))]
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
    .replace(/bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)\s*[:=]\s*\S+/giu, '$1=[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)\b/gu, '[redacted-token]')
    .replace(/https?:\/\/[^\s]+/giu, '[redacted-url]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, '[redacted-email]')
    .trim()
    .slice(0, MAX_SUMMARY_CHARS)
}

function cognitivePath(path: string): string {
  return path.endsWith('.jsonl') ? `${path.slice(0, -'.jsonl'.length)}.cognitive.jsonl` : `${path}.cognitive.jsonl`
}

export default LearningMemoryService
