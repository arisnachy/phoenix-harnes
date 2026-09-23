/** Safe projection and durable recall for verified Computer flows. */

import type { Context } from '@phoenix-ai/cordis'
import type { CognitiveMemoryRecord, MemoryId } from '@phoenix-ai/dsh-session-learning'

/** Closed action vocabulary allowed in a reusable Computer flow. */
export type SafeComputerAction =
  | 'browser_open'
  | 'browser_back'
  | 'browser_forward'
  | 'browser_reload'
  | 'browser_focus'
  | 'browser_inspect'
  | 'browser_fill_form'
  | 'browser_click_text'
  | 'browser_login'
  | 'browser_forget_credentials'

/** One redacted Computer action retained in a learned flow. */
export interface SafeComputerStep {
  readonly action: SafeComputerAction
  readonly origin?: string
}

/** Safe trace held until a verified goal completion is observed. */
export interface SafeComputerTrace {
  readonly sessionId: string
  readonly projectId?: string
  readonly verifiedGoalId: string
  readonly occurredAt: number
  readonly steps: readonly SafeComputerStep[]
}

/** Enumerated preference inferred from repeated verified flows. */
export type SafeComputerPreference = 'preferEmbeddedBrowser' | 'preferFreshObservation'

/** Safe fields exposed by the explicit Computer-learning review operation. */
export interface ComputerMemoryReview {
  readonly id: string
  readonly occurredAt: number
  readonly origin?: string
  readonly actions: readonly SafeComputerAction[]
  readonly status: 'active'
  readonly preference?: SafeComputerPreference
}

/** Storage seam used by the projector and its tests. */
export interface ComputerMemoryStore {
  rememberCognitive(input: {
    readonly sessionId: string
    readonly eventSeq: number
    readonly kind: 'skill' | 'preference'
    readonly layers: readonly ('semantic' | 'procedural' | 'temporal')[]
    readonly content: string
    readonly summary: string
    readonly sourceEventType: string
    readonly occurredAt: number
    readonly projectId?: string
    readonly subject: string
    readonly value: string
    readonly confidence: number
    readonly importance: number
  }): Promise<CognitiveMemoryRecord>
  timeline(query?: { readonly projectId?: string; readonly includeHistory?: boolean }): CognitiveMemoryRecord[]
  forgetCognitive(id: MemoryId): Promise<void>
}

/** Prefix shared by all Computer flow and preference records. */
export const COMPUTER_SUBJECT_PREFIX = 'phoenix.learning.computer.'

const FLOW_SUBJECT_PREFIX = `${COMPUTER_SUBJECT_PREFIX}flow.`
const PREFERENCE_SUBJECT_PREFIX = `${COMPUTER_SUBJECT_PREFIX}preference.`
const STATE_VERSION = 1 as const
const MAX_STEPS = 8
const MAX_REVIEW = 32

interface ComputerFlowValue {
  readonly version: typeof STATE_VERSION
  readonly kind: 'flow'
  readonly status: 'active'
  readonly verifiedGoalId: string
  readonly steps: readonly SafeComputerStep[]
}

interface ComputerPreferenceValue {
  readonly version: typeof STATE_VERSION
  readonly kind: 'preference'
  readonly status: 'active'
  readonly preference: SafeComputerPreference
  readonly evidenceCount: number
}

/** Project a durable Computer tool/call event into safe metadata. */
export function projectComputerEvent(event: unknown): SafeComputerStep | undefined {
  if (!isRecord(event) || event.type !== 'tool/call') return undefined
  return projectComputerCall(event.data)
}

/** Project one raw Computer tool/call payload without retaining its arguments. */
export function projectComputerCall(data: unknown): SafeComputerStep | undefined {
  if (!isRecord(data) || data.name !== 'computer' || typeof data.arguments !== 'string') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(data.arguments) as unknown
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || typeof parsed.action !== 'string') return undefined
  const action = safeAction(parsed.action)
  if (action === undefined) return undefined
  if (action === 'browser_open') {
    const origin = canonicalHttpsOrigin(parsed.url)
    return origin === undefined ? undefined : { action, origin }
  }
  if (action === 'browser_inspect') {
    const origin = parsed.origin === undefined ? undefined : canonicalHttpsOrigin(parsed.origin)
    return parsed.origin !== undefined && origin === undefined ? undefined : {
      action,
      ...origin === undefined ? {} : { origin },
    }
  }
  if (action === 'browser_fill_form' || action === 'browser_click_text'
    || action === 'browser_login' || action === 'browser_forget_credentials') {
    const origin = canonicalHttpsOrigin(parsed.origin)
    return origin === undefined ? undefined : { action, origin }
  }
  return { action }
}

/** Return true for rows owned by this Computer-learning projection. */
export function isComputerMemory(record: CognitiveMemoryRecord): boolean {
  return record.subject?.startsWith(COMPUTER_SUBJECT_PREFIX) === true
}

/** Hide malformed or forgotten Computer rows from ordinary model recall. */
export function filterComputerSearchHits<T extends { record: CognitiveMemoryRecord }>(hits: readonly T[]): T[] {
  return hits.filter(hit => !isComputerMemory(hit.record) || decodeComputerValue(hit.record) !== undefined)
}

/** Derive a bounded non-path project label from a test session when needed. */
export function projectIdForComputerSession(session: unknown): string | undefined {
  if (!isRecord(session) || !isRecord(session.header)) return undefined
  return typeof session.header.agentPreset === 'string' && session.header.agentPreset.trim() !== ''
    ? session.header.agentPreset.trim().slice(0, 256)
    : undefined
}

/** Observe raw session events while retaining only the safe projection. */
export class ComputerLearningProjector {
  private readonly traces = new Map<string, MutableTrace>()

  constructor(private readonly store: ComputerMemoryStore) {}

  /**
   * Consume one session event and discard all raw payload references before returning.
   * @param session - Session envelope supplying the session identifier.
   * @param event - Durable event to project.
   * @param projectId - Optional current project supplied by the learning service.
   */
  async observe(session: unknown, event: unknown, projectId?: string): Promise<void> {
    if (!isRecord(session) || !isRecord(event) || typeof event.type !== 'string') return
    const sessionId = typeof session.id === 'string' ? session.id : String(session.id ?? '')
    if (sessionId === '') return
    const data = event.data
    const occurredAt = typeof event.time === 'number' && Number.isFinite(event.time) ? event.time : Date.now()
    const eventSeq = typeof event.seq === 'number' && Number.isSafeInteger(event.seq) ? event.seq : 0

    if (event.type === 'goal/change' && isRecord(data)) {
      if (data.operation === 'clear') {
        this.traces.delete(sessionId)
        return
      }
      if (data.operation === 'complete') {
        await this.complete(sessionId, data, eventSeq, occurredAt)
      }
      return
    }
    if (event.type === 'goal/false-pass') {
      this.traces.delete(sessionId)
      return
    }
    if (event.type === 'tool/call' && isRecord(data) && data.name === 'computer') {
      let trace = this.traces.get(sessionId)
      if (trace === undefined) {
        const selectedProject = projectId ?? projectIdForComputerSession(session)
        trace = {
          sessionId,
          ...(selectedProject === undefined ? {} : { projectId: selectedProject }),
          steps: [],
          pending: new Set<string>(),
          occurredAt,
          invalid: false,
        }
      }
      const callId = typeof data.callId === 'string' ? data.callId : undefined
      const step = projectComputerCall(data)
      if (callId === undefined || step === undefined || trace.steps.length >= MAX_STEPS) {
        trace.invalid = true
      } else {
        trace.steps.push(step)
        trace.pending.add(callId)
      }
      this.traces.set(sessionId, trace)
      return
    }
    if (event.type === 'tool/result' && isRecord(data)) {
      const message = isRecord(data.message) ? data.message : undefined
      const source = message !== undefined && isRecord(message.source) ? message.source : undefined
      const callId = source !== undefined && typeof source.callId === 'string' ? source.callId : undefined
      const trace = this.traces.get(sessionId)
      if (trace === undefined || callId === undefined || !trace.pending.has(callId)) return
      trace.pending.delete(callId)
      if (toolResultFailed(data)) trace.invalid = true
    }
  }

  /** Return only safe fields for explicit human review. */
  review(projectId?: string): ComputerMemoryReview[] {
    return this.store.timeline({
      ...projectId === undefined ? {} : { projectId },
      includeHistory: false,
    })
      .filter(isComputerMemory)
      .flatMap((record) => {
        const value = decodeComputerValue(record)
        if (value === undefined) return []
        if (value.kind === 'flow') {
          const origin = value.steps.find(step => step.origin !== undefined)?.origin
          return [{
            id: String(record.id),
            occurredAt: record.provenance.occurredAt,
            status: 'active' as const,
            actions: value.steps.map(step => step.action),
            ...origin === undefined ? {} : { origin },
          }]
        }
        return [{
          id: String(record.id),
          occurredAt: record.provenance.occurredAt,
          status: 'active' as const,
          actions: [],
          preference: value.preference,
        }]
      })
      .slice(-MAX_REVIEW)
  }

  /** Forget one exact Computer record and retain the ledger tombstone. */
  async forget(id: string, projectId?: string): Promise<boolean> {
    if (id.trim() === '') return false
    const record = this.store.timeline({
      ...projectId === undefined ? {} : { projectId },
      includeHistory: false,
    }).find(candidate => isComputerMemory(candidate) && String(candidate.id) === id && decodeComputerValue(candidate) !== undefined)
    if (record === undefined) return false
    await this.store.forgetCognitive(record.id)
    return true
  }

  private async complete(
    sessionId: string,
    data: Record<string, unknown>,
    eventSeq: number,
    occurredAt: number,
  ): Promise<void> {
    const trace = this.traces.get(sessionId)
    this.traces.delete(sessionId)
    const goal = isRecord(data.goal) ? data.goal : undefined
    const verifiedGoalId = goal !== undefined && typeof goal.id === 'string' && goal.id.trim() !== '' ? goal.id : undefined
    if (trace === undefined || trace.invalid || trace.pending.size > 0 || trace.steps.length === 0
      || verifiedGoalId === undefined || goal?.phase !== 'complete') return
    const flow: ComputerFlowValue = {
      version: STATE_VERSION,
      kind: 'flow',
      status: 'active',
      verifiedGoalId,
      steps: trace.steps,
    }
    const origin = trace.steps.find(step => step.origin !== undefined)?.origin
    const summary = `Verified Computer flow: ${trace.steps.map(step => step.action).join(' → ')}${origin === undefined ? '' : ` @ ${origin}`}`.slice(0, 512)
    await this.store.rememberCognitive({
      sessionId,
      eventSeq,
      kind: 'skill',
      layers: ['semantic', 'procedural', 'temporal'],
      content: summary,
      summary,
      sourceEventType: 'computer-learning/verified',
      occurredAt,
      ...trace.projectId === undefined ? {} : { projectId: trace.projectId },
      subject: `${FLOW_SUBJECT_PREFIX}${stableKey(`${verifiedGoalId}:${summary}`)}`,
      value: JSON.stringify(flow),
      confidence: 0.95,
      importance: 0.9,
    })
    await this.maybeRememberPreferences(trace, sessionId, eventSeq, occurredAt)
  }

  private async maybeRememberPreferences(
    trace: MutableTrace,
    sessionId: string,
    eventSeq: number,
    occurredAt: number,
  ): Promise<void> {
    if (trace.projectId === undefined) return
    const records = this.store.timeline({ projectId: trace.projectId, includeHistory: false })
    const goals = new Set<string>()
    for (const record of records) {
      if (!record.subject?.startsWith(FLOW_SUBJECT_PREFIX)) continue
      const value = decodeComputerValue(record)
      if (value?.kind === 'flow') goals.add(value.verifiedGoalId)
    }
    if (goals.size < 2) return
    const preference: SafeComputerPreference = trace.steps.some(step => step.action === 'browser_open')
      ? 'preferEmbeddedBrowser'
      : 'preferFreshObservation'
    const summary = preference === 'preferEmbeddedBrowser'
      ? 'Prefer Phoenix embedded browser navigation for web tasks when available.'
      : 'Prefer a fresh Computer observation after state-changing actions.'
    const value: ComputerPreferenceValue = {
      version: STATE_VERSION,
      kind: 'preference',
      status: 'active',
      preference,
      evidenceCount: goals.size,
    }
    await this.store.rememberCognitive({
      sessionId,
      eventSeq,
      kind: 'preference',
      layers: ['semantic', 'procedural', 'temporal'],
      content: summary,
      summary,
      sourceEventType: 'computer-learning/preference',
      occurredAt,
      projectId: trace.projectId,
      subject: `${PREFERENCE_SUBJECT_PREFIX}${preference}`,
      value: JSON.stringify(value),
      confidence: 0.9,
      importance: 0.85,
    })
  }
}

/** Install safe Computer observation into the model-facing learning plugin. */
export function installComputerLearning(ctx: Context): ComputerLearningProjector {
  const projector = new ComputerLearningProjector({
    rememberCognitive: input => ctx.learningMemory.rememberCognitive(input),
    timeline: query => ctx.learningMemory.timeline(query),
    forgetCognitive: id => ctx.learningMemory.forgetCognitive(id),
  })
  ctx.on('session/event', (session, event) => {
    const projectId = ctx.learningMemory.currentProjectId()
    void projector.observe(session, event, projectId).catch((error: unknown) => {
      ctx.logger.warn(`computer-learning: ignored ${String(event.type)} in ${String(session.id)}: ${String(error)}`)
    })
  })
  return projector
}

function safeAction(value: string): SafeComputerAction | undefined {
  switch (value) {
    case 'browser_open':
    case 'browser_back':
    case 'browser_forward':
    case 'browser_reload':
    case 'browser_focus':
    case 'browser_inspect':
    case 'browser_fill_form':
    case 'browser_click_text':
    case 'browser_login':
    case 'browser_forget_credentials':
      return value
    default:
      return undefined
  }
}

function canonicalHttpsOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return undefined
    if (url.hostname === '' || url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

function decodeComputerValue(record: CognitiveMemoryRecord): ComputerFlowValue | ComputerPreferenceValue | undefined {
  if (record.status !== 'active') return undefined
  if (typeof record.value !== 'string') return undefined
  try {
    const raw: unknown = JSON.parse(record.value)
    if (!isRecord(raw) || raw.version !== STATE_VERSION || raw.status !== 'active') return undefined
    if (raw.kind === 'flow' && typeof raw.verifiedGoalId === 'string' && raw.verifiedGoalId !== ''
      && Array.isArray(raw.steps) && raw.steps.length > 0 && raw.steps.length <= MAX_STEPS && raw.steps.every(isSafeStep)) {
      return raw as unknown as ComputerFlowValue
    }
    if (raw.kind === 'preference' && (raw.preference === 'preferEmbeddedBrowser' || raw.preference === 'preferFreshObservation')
      && typeof raw.evidenceCount === 'number' && Number.isSafeInteger(raw.evidenceCount) && raw.evidenceCount >= 2) {
      return raw as unknown as ComputerPreferenceValue
    }
    return undefined
  } catch {
    return undefined
  }
}

function isSafeStep(value: unknown): value is SafeComputerStep {
  if (!isRecord(value) || typeof value.action !== 'string' || safeAction(value.action) === undefined) return false
  return value.origin === undefined || canonicalHttpsOrigin(value.origin) === value.origin
}

function toolResultFailed(data: Record<string, unknown>): boolean {
  if (data.error !== undefined) return true
  const message = isRecord(data.message) ? data.message : undefined
  const content = message?.content
  return Array.isArray(content) && content.some(part => isRecord(part) && part.isError === true)
}

function stableKey(value: string): string {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface MutableTrace {
  readonly sessionId: string
  readonly projectId?: string
  readonly steps: SafeComputerStep[]
  readonly pending: Set<string>
  readonly occurredAt: number
  invalid: boolean
}
