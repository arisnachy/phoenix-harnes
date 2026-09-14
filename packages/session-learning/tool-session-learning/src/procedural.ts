/** Evidence-backed procedural learning for Phoenix. */

import type { Context } from '@phoenix-ai/cordis'
import type { CognitiveMemoryHit, CognitiveMemoryRecord } from '@phoenix-ai/dsh-session-learning'

const PROCEDURE_SUBJECT_PREFIX = 'phoenix.learning.procedure.'
const STATE_VERSION = 1 as const
const MAX_STEPS = 8
const MAX_TEXT_CHARS = 2_048
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 32

export type ProceduralLearningOrigin = 'guided' | 'experience'
export type ProceduralLearningStatus = 'candidate' | 'active' | 'quarantined'

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

export interface ProceduralMemoryStore {
  timeline(query?: {
    readonly projectId?: string
    readonly sessionId?: string
    readonly includeHistory?: boolean
  }): readonly ProceduralStoredMemory[]
  remember(input: ProceduralMemoryWrite): Promise<void>
}

interface ProvenanceInput {
  readonly sessionId: string
  readonly eventSeq: number
  readonly occurredAt: number
  readonly projectId?: string
}

export interface TeachProcedureInput extends ProvenanceInput {
  readonly title: string
  readonly scope: string
  readonly trigger: string
  readonly steps: readonly string[]
  readonly evidence: string
}

export interface ExperienceProcedureInput extends TeachProcedureInput {
  readonly verified: boolean
}

export interface CorrectProcedureInput extends ProvenanceInput {
  readonly key: string
  readonly evidence: string
}

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
  readonly projectId?: string
}

export interface ProceduralRecommendationQuery {
  readonly projectId?: string
  readonly sessionId?: string
  readonly scope?: string
  readonly limit?: number
}

/**
 * Durable procedure learner. Guided teaching is authoritative for the user's
 * workflow; autonomous experience is promoted only after verified outcome.
 */
export class ProceduralLearningEngine {
  private writeTail: Promise<void> = Promise.resolve()

  constructor(private readonly store: ProceduralMemoryStore) {}

  teach(input: TeachProcedureInput): Promise<ProceduralLearningState> {
    return this.enqueue(() => this.writeGuided(input))
  }

  recordExperience(input: ExperienceProcedureInput): Promise<ProceduralLearningState> {
    return this.enqueue(() => this.writeExperience(input))
  }

  correct(input: CorrectProcedureInput): Promise<ProceduralLearningState> {
    return this.enqueue(() => this.writeCorrection(input))
  }

  recommend(query: ProceduralRecommendationQuery = {}): ProceduralLearningState[] {
    const limit = query.limit ?? DEFAULT_LIMIT
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new TypeError(`procedural recommendation limit must be between 1 and ${String(MAX_LIMIT)}`)
    }
    return this.states(query)
      .filter(state => state.status === 'active')
      .filter(state => query.scope === undefined || state.scope === normalizeText(query.scope))
      .sort((left, right) => right.confidence - left.confidence
        || right.confirmations - left.confirmations
        || right.lastObservedAt - left.lastObservedAt)
      .slice(0, limit)
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
    ...raw.projectId === undefined ? {} : { projectId: raw.projectId },
  }
}

/** Hide unverified or corrected procedural memories from ordinary model recall. */
export function filterProceduralSearchHits(hits: readonly CognitiveMemoryHit[]): CognitiveMemoryHit[] {
  return hits.filter((hit) => {
    if (hit.record.subject === undefined || !hit.record.subject.startsWith(PROCEDURE_SUBJECT_PREFIX)) return true
    return decodeProceduralState(cognitiveRow(hit.record))?.status === 'active'
  })
}

/** Bounded, argument-free trace of actions used during one session. */
export class ProceduralExperienceTrace {
  private readonly traces = new Map<string, string[]>()

  toolCall(sessionId: string, toolName: string): void {
    this.push(sessionId, `Use tool ${boundedText(toolName, 'tool name').slice(0, 160)}`)
  }

  recovery(sessionId: string, lesson: string): void {
    const safe = boundedText(lesson, 'recovery lesson')
    rejectSecrets(safe)
    this.push(sessionId, `Recovery lesson: ${safe}`)
  }

  complete(sessionId: string): string[] {
    const steps = [...(this.traces.get(sessionId) ?? [])]
    this.traces.delete(sessionId)
    return steps
  }

  clear(sessionId: string): void { this.traces.delete(sessionId) }

  private push(sessionId: string, value: string): void {
    const current = this.traces.get(sessionId) ?? []
    if (current.length >= MAX_STEPS) return
    if (current.at(-1) === value) return
    current.push(value)
    this.traces.set(sessionId, current)
  }
}

/** Install autonomous learn-by-doing observation into the session-learning plugin. */
export function installProceduralLearning(ctx: Context): ProceduralLearningEngine {
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
        trace.toolCall(sessionId, data.name)
        return
      }
      if (eventType === 'hardness/kernel' && isRecord(data) && data.kind === 'learning-recorded'
        && isRecord(data.learning) && typeof data.learning.solution === 'string') {
        trace.recovery(sessionId, data.learning.solution)
        return
      }
      if (eventType === 'goal/change' && isRecord(data) && data.operation === 'clear') {
        trace.clear(sessionId)
        return
      }
      if (eventType !== 'goal/change' || !isRecord(data) || data.operation !== 'complete') return
      const steps = trace.complete(sessionId)
      if (steps.length === 0) return
      const title = `Verified procedure: ${steps.slice(0, 3).join(' → ')}`.slice(0, 512)
      await engine.recordExperience({
        title,
        scope: projectId ?? 'global',
        trigger: 'A sufficiently similar task reaches verified completion.',
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
