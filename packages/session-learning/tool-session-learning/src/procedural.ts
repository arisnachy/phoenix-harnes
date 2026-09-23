/** Evidence-backed procedural learning for Phoenix. */

import type { Context } from '@phoenix-ai/cordis'
import type { CognitiveMemoryHit, CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'
import {
  decodeTaskFingerprint,
  fingerprintTask,
  TASK_RELEVANCE_THRESHOLD,
  taskSimilarity,
  type TaskFingerprint,
} from './task-context.ts'

const PROCEDURE_SUBJECT_PREFIX = 'phoenix.learning.procedure.'
const STATE_VERSION = 1 as const
const MAX_STEPS = 8
const MAX_TEXT_CHARS = 2_048
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 32

/** Provenance category describing how Phoenix acquired one procedure. */
export type ProceduralLearningOrigin = 'guided' | 'experience'
/** Promotion lifecycle controlling whether a learned procedure may be recalled. */
export type ProceduralLearningStatus = 'candidate' | 'active' | 'quarantined'

/** Minimal cognitive-memory row consumed by the procedural learner. */
export interface ProceduralStoredMemory {
  readonly subject?: string
  readonly value?: string
  readonly summary: string
  readonly projectId?: string
  readonly sessionId: string
  readonly status: 'active' | 'superseded' | 'obsolete' | 'forgotten'
  readonly occurredAt: number
  readonly sourceEventType: string
}

/** Durable cognitive-memory write produced by procedural learning. */
export interface ProceduralMemoryWrite {
  readonly subject: string
  readonly value: string
  readonly summary: string
  readonly sessionId: string
  readonly eventSeq: number
  readonly sourceEventType: string
  readonly occurredAt: number
  readonly confidence: number
  readonly importance: number
  readonly projectId?: string
}

/** Storage seam allowing the procedural policy to be tested independently. */
export interface ProceduralMemoryStore {
  /**
   * Read current or historical procedural-memory rows.
   * @param query - Optional project, session, and history filters.
   * @returns Matching durable memory rows.
   */
  timeline(query?: {
    readonly projectId?: string
    readonly sessionId?: string
    readonly includeHistory?: boolean
  }): readonly ProceduralStoredMemory[]
  /**
   * Persist one versioned procedural-memory row.
   * @param input - Secret-free procedural state and provenance to store.
   * @returns Completion after the durable write finishes.
   */
  remember(input: ProceduralMemoryWrite): Promise<void>
}

interface ProvenanceInput {
  readonly sessionId: string
  readonly eventSeq: number
  readonly occurredAt: number
  readonly projectId?: string
}

/** Structured user teaching accepted as an authoritative workflow procedure. */
export interface TeachProcedureInput extends ProvenanceInput {
  readonly title: string
  readonly scope: string
  readonly trigger: string
  readonly steps: readonly string[]
  readonly evidence: string
}

/** Observable work sequence that may be promoted after verified completion. */
export interface ExperienceProcedureInput extends TeachProcedureInput {
  readonly verified: boolean
}

/** Explicit correction that quarantines an existing learned procedure. */
export interface CorrectProcedureInput extends ProvenanceInput {
  readonly key: string
  readonly evidence: string
}

/** Versioned durable state for one guided or experience-derived procedure. */
export interface ProceduralLearningState {
  readonly version: typeof STATE_VERSION
  readonly key: string
  readonly title: string
  readonly origin: ProceduralLearningOrigin
  readonly status: ProceduralLearningStatus
  readonly scope: string
  readonly trigger: string
  readonly steps: readonly string[]
  readonly confirmations: number
  readonly failures: number
  readonly corrections: number
  readonly confidence: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly lastEvidence: string
  readonly taskFingerprint?: TaskFingerprint
  readonly projectId?: string
}

/** Filters used to select reusable active procedures. */
export interface ProceduralRecommendationQuery {
  readonly projectId?: string
  readonly sessionId?: string
  readonly scope?: string
  /** Current user task used to reject and rank unrelated procedures. */
  readonly taskContext?: string
  readonly limit?: number
}

/** Optional task-context provider used by learn-by-doing completion. */
export interface ProceduralTaskContextProvider {
  /**
   * Return the bounded task currently being executed by a session.
   * @param sessionId - Active Phoenix session id.
   * @returns Current user task, or undefined when no reliable task is known.
   */
  currentTask(sessionId: string): string | undefined
}

/** Durable procedure learner with evidence-backed promotion and correction. */
export class ProceduralLearningEngine {
  private writeTail: Promise<void> = Promise.resolve()

  constructor(private readonly store: ProceduralMemoryStore) {}

  /**
   * Retain one explicit user-taught procedure as active knowledge.
   * @param input - Structured, secret-free user teaching with provenance.
   * @returns The durable active procedural state after the write.
   */
  teach(input: TeachProcedureInput): Promise<ProceduralLearningState> {
    return this.enqueue(() => this.writeGuided(input))
  }

  /**
   * Record an observed procedure and promote it only when its result is verified.
   * @param input - Observable execution steps, evidence, and verification state.
   * @returns Candidate or active procedural state after applying the evidence.
   */
  recordExperience(input: ExperienceProcedureInput): Promise<ProceduralLearningState> {
    return this.enqueue(() => this.writeExperience(input))
  }

  /**
   * Quarantine a learned procedure after an explicit correction.
   * @param input - Procedure key and corrective evidence with provenance.
   * @returns Quarantined procedural state after the correction is persisted.
   */
  correct(input: CorrectProcedureInput): Promise<ProceduralLearningState> {
    return this.enqueue(() => this.writeCorrection(input))
  }

  /**
   * Return only active reusable procedures matching the requested context.
   * @param query - Optional project, session, scope, task-context, and result-count filters.
   * @returns Active procedures ordered by task relevance then confidence and recent evidence.
   */
  recommend(query: ProceduralRecommendationQuery = {}): ProceduralLearningState[] {
    const limit = query.limit ?? DEFAULT_LIMIT
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new TypeError(`procedural recommendation limit must be between 1 and ${String(MAX_LIMIT)}`)
    }
    const active = this.states(query)
      .filter(state => state.status === 'active')
      .filter(state => query.scope === undefined || state.scope === normalizeText(query.scope))
    if (query.taskContext === undefined || normalizeText(query.taskContext) === '') {
      return active
        .sort((left, right) => right.confidence - left.confidence
          || right.confirmations - left.confirmations
          || right.lastObservedAt - left.lastObservedAt)
        .slice(0, limit)
    }

    const current = fingerprintTask(query.taskContext)
    return active
      .map(state => ({ state, relevance: taskSimilarity(current, state.taskFingerprint ?? fingerprintProcedure(state)) }))
      .filter(item => item.relevance >= TASK_RELEVANCE_THRESHOLD)
      .sort((left, right) => right.relevance - left.relevance
        || right.state.confidence - left.state.confidence
        || right.state.confirmations - left.state.confirmations
        || right.state.lastObservedAt - left.state.lastObservedAt)
      .slice(0, limit)
      .map(item => item.state)
  }

  private enqueue(task: () => Promise<ProceduralLearningState>): Promise<ProceduralLearningState> {
    const run = this.writeTail.then(task)
    this.writeTail = run.then(() => undefined, () => undefined)
    return run
  }

  private async writeGuided(input: TeachProcedureInput): Promise<ProceduralLearningState> {
    const normalized = normalizeProcedure(input)
    const key = procedureKey(normalized.title, normalized.scope, normalized.trigger)
    const previous = this.findByKey(key, normalized.projectId)
    const next: ProceduralLearningState = {
      version: STATE_VERSION,
      key,
      title: normalized.title,
      origin: 'guided',
      status: 'active',
      scope: normalized.scope,
      trigger: normalized.trigger,
      steps: normalized.steps,
      confirmations: Math.max(2, (previous?.confirmations ?? 0) + 2),
      failures: previous?.failures ?? 0,
      corrections: previous?.corrections ?? 0,
      confidence: Math.max(0.95, previous?.confidence ?? 0),
      firstObservedAt: previous?.firstObservedAt ?? normalized.occurredAt,
      lastObservedAt: normalized.occurredAt,
      lastEvidence: normalized.evidence,
      taskFingerprint: fingerprintTask([normalized.title, normalized.scope, normalized.trigger, ...normalized.steps]),
      ...normalized.projectId === undefined ? {} : { projectId: normalized.projectId },
    }
    await this.persist(next, normalized, 'procedural/guided')
    return next
  }

  private async writeExperience(input: ExperienceProcedureInput): Promise<ProceduralLearningState> {
    const normalized = normalizeProcedure(input)
    const key = procedureKey(normalized.title, normalized.scope, normalized.trigger)
    const previous = this.findByKey(key, normalized.projectId)
    const confirmations = (previous?.confirmations ?? 0) + (input.verified ? 2 : 1)
    const confidence = input.verified
      ? Math.max(0.85, Math.min(0.98, (previous?.confidence ?? 0.5) + 0.25))
      : Math.max(previous?.confidence ?? 0.5, 0.5)
    const next: ProceduralLearningState = {
      version: STATE_VERSION,
      key,
      title: normalized.title,
      origin: 'experience',
      status: input.verified ? 'active' : 'candidate',
      scope: normalized.scope,
      trigger: normalized.trigger,
      steps: normalized.steps,
      confirmations,
      failures: previous?.failures ?? 0,
      corrections: previous?.corrections ?? 0,
      confidence,
      firstObservedAt: previous?.firstObservedAt ?? normalized.occurredAt,
      lastObservedAt: normalized.occurredAt,
      lastEvidence: normalized.evidence,
      taskFingerprint: fingerprintTask([normalized.title, normalized.scope, normalized.trigger, ...normalized.steps]),
      ...normalized.projectId === undefined ? {} : { projectId: normalized.projectId },
    }
    await this.persist(next, normalized, input.verified ? 'procedural/experience/verified' : 'procedural/experience/candidate')
    return next
  }

  private async writeCorrection(input: CorrectProcedureInput): Promise<ProceduralLearningState> {
    validateProvenance(input)
    const evidence = boundedText(input.evidence, 'evidence')
    rejectSecrets(evidence)
    const key = boundedText(input.key, 'key')
    const previous = this.findByKey(key, input.projectId)
    if (previous === undefined) throw new Error(`unknown procedural learning key: ${key}`)
    const next: ProceduralLearningState = {
      ...previous,
      status: 'quarantined',
      corrections: previous.corrections + 1,
      confidence: Math.max(0.05, previous.confidence - 0.6),
      lastObservedAt: input.occurredAt,
      lastEvidence: evidence,
    }
    await this.persist(next, { ...input, evidence }, 'procedural/correction')
    return next
  }

  private states(query: { readonly projectId?: string; readonly sessionId?: string }): ProceduralLearningState[] {
    const latest = new Map<string, ProceduralLearningState>()
    for (const row of this.store.timeline({
      ...query.projectId === undefined ? {} : { projectId: query.projectId },
      ...query.sessionId === undefined ? {} : { sessionId: query.sessionId },
      includeHistory: false,
    })) {
      const state = decodeProceduralState(row)
      if (state !== undefined) latest.set(state.key, state)
    }
    return [...latest.values()]
  }

  private findByKey(key: string, projectId?: string): ProceduralLearningState | undefined {
    return this.states(projectId === undefined ? {} : { projectId }).find(state => state.key === key)
  }

  private async persist(
    state: ProceduralLearningState,
    provenance: ProvenanceInput & { readonly evidence: string },
    sourceEventType: string,
  ): Promise<void> {
    const summary = state.status === 'active'
      ? `Validated ${state.origin} procedure: ${state.title}. Trigger: ${state.trigger}. Steps: ${state.steps.join(' → ')}`
      : state.status === 'quarantined'
        ? `Quarantined procedure: ${state.title}. Do not reuse without new validated teaching or evidence.`
        : `Candidate procedure awaiting verified outcome: ${state.title}.`
    await this.store.remember({
      subject: `${PROCEDURE_SUBJECT_PREFIX}${state.key}`,
      value: JSON.stringify(state),
      summary,
      sessionId: provenance.sessionId,
      eventSeq: provenance.eventSeq,
      sourceEventType,
      occurredAt: provenance.occurredAt,
      confidence: state.confidence,
      importance: state.status === 'active' ? 0.98 : state.status === 'quarantined' ? 0.95 : 0.8,
      ...provenance.projectId === undefined ? {} : { projectId: provenance.projectId },
    })
  }
}

interface NormalizedProcedure extends ProvenanceInput {
  readonly title: string
  readonly scope: string
  readonly trigger: string
  readonly steps: readonly string[]
  readonly evidence: string
}

function normalizeProcedure(input: TeachProcedureInput): NormalizedProcedure {
  validateProvenance(input)
  const title = boundedText(input.title, 'title')
  const scope = boundedText(input.scope, 'scope')
  const trigger = boundedText(input.trigger, 'trigger')
  const evidence = boundedText(input.evidence, 'evidence')
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > MAX_STEPS) {
    throw new TypeError(`procedural steps must contain between 1 and ${String(MAX_STEPS)} entries`)
  }
  const steps = input.steps.map((step, index) => boundedText(step, `step ${String(index + 1)}`))
  for (const value of [title, scope, trigger, evidence, ...steps]) rejectSecrets(value)
  return { ...input, title, scope, trigger, steps, evidence }
}

function validateProvenance(input: ProvenanceInput): void {
  if (input.sessionId.trim() === '') throw new TypeError('procedural sessionId must be non-empty')
  if (!Number.isSafeInteger(input.eventSeq) || input.eventSeq < 0) throw new TypeError('procedural eventSeq must be non-negative')
  if (!Number.isFinite(input.occurredAt) || input.occurredAt < 0) throw new TypeError('procedural occurredAt must be non-negative')
}

function boundedText(value: string, field: string): string {
  const normalized = normalizeText(value)
  if (normalized === '' || normalized.length > MAX_TEXT_CHARS) {
    throw new TypeError(`procedural ${field} must be non-empty and at most ${String(MAX_TEXT_CHARS)} characters`)
  }
  return normalized
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function rejectSecrets(value: string): void {
  const secretPatterns = [
    /\bbearer\s+\S+/iu,
    /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie)\s*[:=]\s*\S+/iu,
    /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/u,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  ] as const
  if (secretPatterns.some(pattern => pattern.test(value))) throw new TypeError('procedural learning refuses secret-bearing content')
}

function procedureKey(title: string, scope: string, trigger: string): string {
  const normalized = `${scope}\n${trigger}\n${title}`.normalize('NFKD').toLocaleLowerCase().replace(/\p{Diacritic}/gu, '')
  let hash = 0x811c9dc5
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function fingerprintProcedure(state: ProceduralLearningState): TaskFingerprint {
  return fingerprintTask([state.title, state.scope, state.trigger, ...state.steps])
}

/**
 * Decode one procedural-memory row without trusting arbitrary stored JSON.
 * @param row - Cognitive-memory row that may contain versioned procedure state.
 * @returns Valid procedural state, or undefined for unrelated or malformed data.
 */
export function decodeProceduralState(row: ProceduralStoredMemory): ProceduralLearningState | undefined {
  if (row.subject === undefined || !row.subject.startsWith(PROCEDURE_SUBJECT_PREFIX) || row.value === undefined) return undefined
  let raw: unknown
  try { raw = JSON.parse(row.value) } catch { return undefined }
  if (!isRecord(raw) || raw.version !== STATE_VERSION) return undefined
  if (typeof raw.key !== 'string' || typeof raw.title !== 'string' || typeof raw.scope !== 'string' || typeof raw.trigger !== 'string') return undefined
  if (raw.origin !== 'guided' && raw.origin !== 'experience') return undefined
  if (raw.status !== 'candidate' && raw.status !== 'active' && raw.status !== 'quarantined') return undefined
  if (!Array.isArray(raw.steps) || raw.steps.length === 0 || !raw.steps.every(step => typeof step === 'string')) return undefined
  if (!isCount(raw.confirmations) || !isCount(raw.failures) || !isCount(raw.corrections)) return undefined
  if (!isConfidence(raw.confidence) || !isTimestamp(raw.firstObservedAt) || !isTimestamp(raw.lastObservedAt) || typeof raw.lastEvidence !== 'string') return undefined
  if (raw.projectId !== undefined && typeof raw.projectId !== 'string') return undefined
  const taskFingerprint = raw.taskFingerprint === undefined ? undefined : decodeTaskFingerprint(raw.taskFingerprint)
  if (raw.taskFingerprint !== undefined && taskFingerprint === undefined) return undefined
  return {
    version: STATE_VERSION,
    key: raw.key,
    title: raw.title,
    origin: raw.origin,
    status: raw.status,
    scope: raw.scope,
    trigger: raw.trigger,
    steps: raw.steps,
    confirmations: raw.confirmations,
    failures: raw.failures,
    corrections: raw.corrections,
    confidence: raw.confidence,
    firstObservedAt: raw.firstObservedAt,
    lastObservedAt: raw.lastObservedAt,
    lastEvidence: raw.lastEvidence,
    ...taskFingerprint === undefined ? {} : { taskFingerprint },
    ...raw.projectId === undefined ? {} : { projectId: raw.projectId },
  }
}

/**
 * Hide unverified or corrected procedural memories from ordinary model recall.
 * @param hits - Cognitive-memory search hits that may include procedure rows.
 * @returns Hits containing only active procedure rows plus unrelated memories.
 */
export function filterProceduralSearchHits(hits: readonly CognitiveMemoryHit[]): CognitiveMemoryHit[] {
  return hits.filter((hit) => {
    if (hit.record.subject === undefined || !hit.record.subject.startsWith(PROCEDURE_SUBJECT_PREFIX)) return true
    return decodeProceduralState(cognitiveRow(hit.record))?.status === 'active'
  })
}

/** Bounded, argument-free trace of observable work used during one session. */
export class ProceduralExperienceTrace {
  private readonly traces = new Map<string, string[]>()

  /**
   * Record one tool choice without retaining raw arguments.
   * @param sessionId - Session whose experience trace receives the step.
   * @param toolName - Public tool name chosen during execution.
   */
  toolCall(sessionId: string, toolName: string): void {
    this.push(sessionId, `Use tool ${boundedText(toolName, 'tool name').slice(0, 160)}`)
  }

  /**
   * Record one HARDNESS strategy selection.
   * @param sessionId - Session whose experience trace receives the step.
   * @param strategy - Bounded strategy label selected by the mission kernel.
   */
  decision(sessionId: string, strategy: string): void {
    const safe = boundedText(strategy, 'strategy decision')
    rejectSecrets(safe)
    this.push(sessionId, `Strategy decision: ${safe}`)
  }

  /**
   * Record an action executed inside a Living Creation without its raw payload.
   * @param sessionId - Session whose experience trace receives the step.
   * @param action - Declared Living action name.
   */
  livingAction(sessionId: string, action: string): void {
    const safe = boundedText(action, 'Living action')
    rejectSecrets(safe)
    this.push(sessionId, `Living action: ${safe}`)
  }

  /**
   * Record one reusable HARDNESS recovery lesson.
   * @param sessionId - Session whose experience trace receives the lesson.
   * @param lesson - Secret-free recovery strategy produced by HARDNESS.
   */
  recovery(sessionId: string, lesson: string): void {
    const safe = boundedText(lesson, 'recovery lesson')
    rejectSecrets(safe)
    this.push(sessionId, `Recovery lesson: ${safe}`)
  }

  /**
   * Consume and clear the bounded trace at verified completion.
   * @param sessionId - Session whose observable work is being completed.
   * @returns Ordered argument-free procedural steps collected for the session.
   */
  complete(sessionId: string): string[] {
    const steps = [...(this.traces.get(sessionId) ?? [])]
    this.traces.delete(sessionId)
    return steps
  }

  /**
   * Drop an unfinished trace when its goal is cleared.
   * @param sessionId - Session whose stale work should be discarded.
   */
  clear(sessionId: string): void { this.traces.delete(sessionId) }

  private push(sessionId: string, value: string): void {
    const current = this.traces.get(sessionId) ?? []
    if (current.length >= MAX_STEPS) return
    if (current.at(-1) === value) return
    current.push(value)
    this.traces.set(sessionId, current)
  }
}

/**
 * Install autonomous learn-by-doing observation into the session-learning plugin.
 * @param ctx - Cordis context providing session events and cognitive memory.
 * @param taskContext - Optional source of the actual current task for verified learning.
 * @returns Procedural engine used by automatic learning and guided teaching.
 */
export function installProceduralLearning(
  ctx: Context,
  taskContext?: ProceduralTaskContextProvider,
): ProceduralLearningEngine {
  const engine = new ProceduralLearningEngine(cognitiveStore(ctx))
  const trace = new ProceduralExperienceTrace()

  ctx.on('session/event', (session, event) => {
    const sessionId = String(session.id)
    const eventType = String(event.type)
    const data = event.data as unknown
    const eventSeq = typeof event.seq === 'number' ? event.seq : 0
    const occurredAt = typeof event.time === 'number' ? event.time : Date.now()
    const projectId = ctx.learningMemory.currentProjectId()

    const run = async (): Promise<void> => {
      if (eventType === 'tool/call' && isRecord(data) && typeof data.name === 'string' && data.name.trim() !== '') {
        // Computer has a dedicated redacted projector. The generic trace must
        // never turn raw desktop actions into an independently recalled flow.
        if (data.name === 'computer') return
        if (data.name === 'living_act' && isRecord(data.arguments) && typeof data.arguments.action === 'string') {
          trace.livingAction(sessionId, data.arguments.action)
        } else {
          trace.toolCall(sessionId, data.name)
        }
        return
      }
      if (eventType === 'hardness/kernel' && isRecord(data)) {
        if (data.kind === 'learning-recorded' && isRecord(data.learning) && typeof data.learning.solution === 'string') {
          trace.recovery(sessionId, data.learning.solution)
          return
        }
        if (data.kind === 'route-selected' && typeof data.strategy === 'string') {
          trace.decision(sessionId, data.strategy)
          return
        }
      }
      if (eventType === 'goal/change' && isRecord(data) && data.operation === 'clear') {
        trace.clear(sessionId)
        return
      }
      if (eventType !== 'goal/change' || !isRecord(data) || data.operation !== 'complete') return
      const steps = trace.complete(sessionId)
      if (steps.length === 0) return
      const title = `Verified procedure: ${steps.slice(0, 3).join(' → ')}`.slice(0, 512)
      const currentTask = taskContext?.currentTask(sessionId)
      await engine.recordExperience({
        title,
        scope: projectId ?? 'global',
        trigger: currentTask ?? 'A sufficiently similar task reaches verified completion.',
        steps,
        evidence: 'Phoenix goal completion passed the configured fail-closed verification path.',
        verified: true,
        sessionId,
        eventSeq,
        occurredAt,
        ...projectId === undefined ? {} : { projectId },
      })
    }

    void run().catch((error: unknown) => {
      ctx.logger.warn(`procedural-learning: ignored ${eventType} outcome in ${sessionId}: ${String(error)}`)
    })
  })
  return engine
}

function cognitiveStore(ctx: Context): ProceduralMemoryStore {
  return {
    timeline(query = {}) {
      return ctx.learningMemory.timeline({
        ...query.projectId === undefined ? {} : { projectId: query.projectId },
        ...query.sessionId === undefined ? {} : { sessionId: query.sessionId },
        ...query.includeHistory === undefined ? {} : { includeHistory: query.includeHistory },
      }).map(cognitiveRow)
    },
    async remember(input) {
      await ctx.learningMemory.rememberCognitive({
        sessionId: input.sessionId,
        eventSeq: input.eventSeq,
        kind: 'lesson',
        layers: ['autobiographical', 'episodic', 'semantic', 'procedural', 'temporal'],
        content: input.summary,
        summary: input.summary,
        sourceEventType: input.sourceEventType,
        occurredAt: input.occurredAt,
        subject: input.subject,
        value: input.value,
        confidence: input.confidence,
        importance: input.importance,
        ...input.projectId === undefined ? {} : { projectId: input.projectId },
      })
    },
  }
}

function cognitiveRow(record: CognitiveMemoryRecord): ProceduralStoredMemory {
  return {
    summary: record.summary,
    sessionId: record.sessionId,
    status: record.status,
    occurredAt: record.provenance.occurredAt,
    sourceEventType: record.provenance.sourceEventType,
    ...record.subject === undefined ? {} : { subject: record.subject },
    ...record.value === undefined ? {} : { value: record.value },
    ...record.projectId === undefined ? {} : { projectId: record.projectId },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isCount(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 }
function isConfidence(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 }
function isTimestamp(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 }
