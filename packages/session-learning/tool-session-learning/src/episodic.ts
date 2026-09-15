/** Durable mission episodes derived from observable Phoenix work. */

import type { CognitiveMemoryInput, CognitiveMemoryLayer } from '@phoenix-ai/dsh-session-learning'

const EPISODE_SUBJECT_PREFIX = 'phoenix.episode.mission.'
const STATE_VERSION = 1 as const
const MAX_TEXT_CHARS = 768
const MAX_PROJECT_CHARS = 256
const MAX_TOOL_CHARS = 96
const MAX_TOOLS = 8

/** Verification state retained with one durable mission episode. */
export type MissionVerification = 'verified' | 'unverified'

/** Versioned secret-free mission state stored in cognitive memory. */
export interface MissionEpisode {
  readonly version: typeof STATE_VERSION
  readonly id: string
  readonly sessionId: string
  readonly userIntent: string
  readonly startedAt: number
  readonly endedAt: number
  readonly verification: MissionVerification
  readonly tools: readonly string[]
  readonly outcome: string
  readonly projectId?: string
}

/** Minimal storage capability used by the recorder. */
export interface EpisodicMemoryStore {
  /** Persist one cognitive mission record. */
  remember(input: CognitiveMemoryInput): Promise<void>
}

/** Metadata supplied when a substantive user task begins. */
export interface MissionStartOptions {
  readonly occurredAt: number
  readonly projectId?: string
}

/** Evidence supplied when observable work reaches a terminal outcome. */
export interface MissionCompletionOptions {
  readonly eventSeq: number
  readonly occurredAt: number
  readonly verified: boolean
  readonly outcome: string
}

interface MutableMissionTrace {
  sessionId: string
  userIntent: string
  startedAt: number
  projectId?: string
  tools: string[]
}

/** Bounded learn-by-doing recorder that promotes completed work to durable episodic evidence. */
export class EpisodicMissionRecorder {
  private readonly traces = new Map<string, MutableMissionTrace>()

  /** @param store - Durable cognitive memory writer. */
  constructor(private readonly store: EpisodicMemoryStore) {}

  /** Observe the effective task without storing raw model context. */
  observeUserMessage(sessionId: string, text: string, options: MissionStartOptions): void {
    validateTimestamp(options.occurredAt, 'mission start')
    const safeText = sanitize(text)
    if (!isSubstantiveTask(safeText)) return
    const existing = this.traces.get(sessionId)
    if (existing === undefined) {
      this.traces.set(sessionId, {
        sessionId,
        userIntent: safeText,
        startedAt: options.occurredAt,
        tools: [],
        ...options.projectId === undefined ? {} : { projectId: boundProject(options.projectId) },
      })
      return
    }
    existing.userIntent = safeText
    if (options.projectId !== undefined) existing.projectId = boundProject(options.projectId)
  }

  /** Record one public tool choice and deliberately ignore its raw arguments. */
  observeToolCall(sessionId: string, toolName: string, _arguments?: unknown): void {
    const trace = this.traces.get(sessionId)
    if (trace === undefined || trace.tools.length >= MAX_TOOLS) return
    const safeName = sanitize(toolName).slice(0, MAX_TOOL_CHARS)
    if (safeName === '' || trace.tools.includes(safeName)) return
    trace.tools.push(safeName)
  }

  /** Observe only success/failure presence; raw result content is intentionally discarded. */
  observeToolResult(_sessionId: string, _result: unknown, _isError: boolean): void {}

  /** Finish and persist one mission when a tracked user task exists. */
  async complete(sessionId: string, options: MissionCompletionOptions): Promise<MissionEpisode | undefined> {
    validateTimestamp(options.occurredAt, 'mission completion')
    if (!Number.isSafeInteger(options.eventSeq) || options.eventSeq < 0) throw new TypeError('mission eventSeq must be a non-negative safe integer')
    const trace = this.traces.get(sessionId)
    if (trace === undefined) return undefined
    this.traces.delete(sessionId)

    const outcome = sanitize(options.outcome)
    const id = missionId(trace.sessionId, trace.startedAt, trace.userIntent)
    const episode: MissionEpisode = {
      version: STATE_VERSION,
      id,
      sessionId: trace.sessionId,
      userIntent: trace.userIntent,
      startedAt: trace.startedAt,
      endedAt: Math.max(trace.startedAt, options.occurredAt),
      verification: options.verified ? 'verified' : 'unverified',
      tools: [...trace.tools],
      outcome,
      ...trace.projectId === undefined ? {} : { projectId: trace.projectId },
    }
    const layers: CognitiveMemoryLayer[] = ['autobiographical', 'episodic', 'temporal']
    if (episode.tools.length > 0) layers.push('procedural', 'associative')
    const summary = sanitize([
      `Mission: ${episode.userIntent}`,
      episode.outcome === '' ? '' : `Outcome: ${episode.outcome}`,
      episode.projectId === undefined ? '' : `Project: ${episode.projectId}`,
    ].filter(Boolean).join(' '))

    await this.store.remember({
      sessionId: trace.sessionId,
      eventSeq: options.eventSeq,
      kind: 'mission',
      layers,
      content: summary,
      summary,
      sourceEventType: options.verified ? 'episodic/mission/verified' : 'episodic/mission/unverified',
      occurredAt: episode.endedAt,
      subject: `${EPISODE_SUBJECT_PREFIX}${id}`,
      value: JSON.stringify(episode),
      confidence: options.verified ? 0.96 : 0.65,
      importance: options.verified ? 0.95 : 0.75,
      ...episode.projectId === undefined ? {} : { projectId: episode.projectId },
    })
    return episode
  }

  /** Drop an abandoned in-flight task without inventing a terminal outcome. */
  clear(sessionId: string): void {
    this.traces.delete(sessionId)
  }
}

/** Decode versioned mission state without trusting arbitrary stored JSON. */
export function decodeMissionEpisode(value: string | undefined): MissionEpisode | undefined {
  if (value === undefined) return undefined
  let raw: unknown
  try { raw = JSON.parse(value) } catch { return undefined }
  if (!isRecord(raw) || raw.version !== STATE_VERSION) return undefined
  if (typeof raw.id !== 'string' || typeof raw.sessionId !== 'string' || typeof raw.userIntent !== 'string') return undefined
  if (!isTimestamp(raw.startedAt) || !isTimestamp(raw.endedAt) || raw.endedAt < raw.startedAt) return undefined
  if (raw.verification !== 'verified' && raw.verification !== 'unverified') return undefined
  if (!Array.isArray(raw.tools) || raw.tools.length > MAX_TOOLS || !raw.tools.every(tool => typeof tool === 'string' && tool.length <= MAX_TOOL_CHARS)) return undefined
  if (typeof raw.outcome !== 'string' || raw.outcome.length > MAX_TEXT_CHARS) return undefined
  if (raw.userIntent.length > MAX_TEXT_CHARS) return undefined
  if (raw.projectId !== undefined && (typeof raw.projectId !== 'string' || raw.projectId.length > MAX_PROJECT_CHARS)) return undefined
  return {
    version: STATE_VERSION,
    id: raw.id,
    sessionId: raw.sessionId,
    userIntent: raw.userIntent,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    verification: raw.verification,
    tools: raw.tools,
    outcome: raw.outcome,
    ...raw.projectId === undefined ? {} : { projectId: raw.projectId },
  }
}

/** Return whether a cognitive subject belongs to a durable mission episode. */
export function isMissionEpisodeSubject(subject: string | undefined): boolean {
  return subject?.startsWith(EPISODE_SUBJECT_PREFIX) === true
}

function missionId(sessionId: string, startedAt: number, intent: string): string {
  const source = `${sessionId}\n${String(startedAt)}\n${intent}`
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function sanitize(value: string): string {
  return bounded(value)
    .replace(/bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)\s*[:=]\s*\S+/giu, '$1=[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+)\b/gu, '[redacted-token]')
}

function bounded(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, MAX_TEXT_CHARS)
}

function boundProject(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().slice(0, MAX_PROJECT_CHARS)
}

function isSubstantiveTask(value: string): boolean {
  return value.length >= 8 && /[\p{L}\p{N}]/u.test(value)
}

function validateTimestamp(value: number, field: string): void {
  if (!isTimestamp(value)) throw new TypeError(`${field} timestamp must be non-negative and finite`)
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
