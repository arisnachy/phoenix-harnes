/** Durable mission state machine for HARDNESS recovery, evidence, and verification. */

import type { CallId } from '@phoenix-ai/dsh-llm'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'

/** A failure belongs to disposable work inside a mission, never to the mission itself. */
export type MissionFailureScope = 'attempt' | 'plan' | 'tool' | 'strategy'

/** Durable mission states. A mission only terminates in `DONE`. */
export type MissionStatus = 'ACTIVE' | 'RECOVERING' | 'WAITING_EXTERNAL' | 'VERIFYING' | 'DONE'

/** Reason a mission entered its only terminal state. */
export type MissionTerminalReason = 'verified' | 'user_cancelled'

/** Ordered evidence state for one mandatory or optional acceptance criterion. */
export type MissionCriterionStatus = 'PENDING' | 'IMPLEMENTED' | 'TESTED' | 'VERIFIED'

/** One deliverable locked at mission start. */
export interface MissionDeliverable {
  readonly id: string
  readonly description: string
}

/** User objective and acceptance contract retained for the life of a mission. */
export interface MissionGoalLock {
  readonly objective: string
  readonly deliverables: readonly MissionDeliverable[]
  readonly acceptanceCriteria: readonly {
    readonly id: string
    readonly description: string
    readonly mandatory: boolean
  }[]
  readonly qualityRequirements: readonly string[]
}

/** Current durable state of one acceptance criterion. */
export interface MissionCriterion {
  readonly id: string
  readonly description: string
  readonly mandatory: boolean
  readonly status: MissionCriterionStatus
  readonly evidence: readonly string[]
}

/** One bounded recovery route proposed by WALL_PROTOCOL. */
export interface MissionRoute {
  readonly id: string
  readonly strategy: string
  readonly rationale: string
  readonly priority: number
}

/** Reusable failure-to-solution memory retained by the mission kernel. */
export interface MissionLearning {
  readonly fingerprint: string
  readonly solution: string
  readonly evidence: readonly string[]
}

/** Quality verdict required in addition to functional criterion evidence. */
export interface MissionQualityGate {
  readonly verdict: 'pass' | 'fail'
  readonly summary: string
  readonly evidence: readonly string[]
  readonly findings: readonly string[]
}

/** Criterion-level review returned by the independent judge. */
export interface MissionCriterionReview {
  readonly id: string
  readonly verdict: 'pass' | 'fail'
  readonly evidence: readonly string[]
  readonly findings: readonly string[]
}

/** Structured decision produced by an independent judge. */
export interface MissionJudgeDecision {
  readonly verdict: 'pass' | 'needs_changes' | 'blocked'
  readonly summary: string
  readonly evidence: readonly string[]
  readonly requiredChanges: readonly string[]
  readonly criteria: readonly MissionCriterionReview[]
  readonly quality: MissionQualityGate
}

/** Durable mission snapshot reconstructed from kernel events. */
export interface MissionKernelState {
  readonly missionId: string
  readonly revision: number
  readonly status: MissionStatus
  readonly terminalReason?: MissionTerminalReason
  readonly goal: MissionGoalLock
  readonly criteria: readonly MissionCriterion[]
  readonly attempts: number
  readonly failures: number
  readonly lastFailureFingerprint?: string
  readonly lastFailureCause?: string
  readonly lastFailureStrategy?: string
  readonly lastRootCause?: string
  readonly selectedRoute?: string
  readonly routes: readonly MissionRoute[]
  readonly missingDependency?: string
  readonly judge?: MissionJudgeDecision
  readonly quality?: MissionQualityGate
  readonly learnings: readonly MissionLearning[]
}

/** Secret-free event emitted by the Mission Persistence Kernel. */
export type MissionKernelEvent =
  | { readonly kind: 'started'; readonly missionId: string; readonly revision: number; readonly status: 'ACTIVE'; readonly goal: MissionGoalLock }
  | {
    readonly kind: 'failure'
    readonly missionId: string
    readonly revision: number
    readonly scope: MissionFailureScope
    readonly strategy: string
    readonly fingerprint: string
    readonly cause: string
    readonly rootCause: string
    readonly repeated: boolean
    readonly status: 'RECOVERING' | 'WAITING_EXTERNAL'
  }
  | {
    readonly kind: 'wall-opened'
    readonly missionId: string
    readonly revision: number
    readonly reason: string
    readonly status: 'RECOVERING' | 'WAITING_EXTERNAL'
    readonly missingDependency?: string
  }
  | {
    readonly kind: 'routes-proposed'
    readonly missionId: string
    readonly revision: number
    readonly routes: readonly MissionRoute[]
  }
  | {
    readonly kind: 'route-selected'
    readonly missionId: string
    readonly revision: number
    readonly routeId: string
    readonly strategy: string
  }
  | {
    readonly kind: 'criterion'
    readonly missionId: string
    readonly revision: number
    readonly criterionId: string
    readonly status: MissionCriterionStatus
    readonly evidence: readonly string[]
  }
  | {
    readonly kind: 'dependency-missing'
    readonly missionId: string
    readonly revision: number
    readonly dependency: string
    readonly detail: string
  }
  | {
    readonly kind: 'skill-registered'
    readonly missionId: string
    readonly revision: number
    readonly skillId: string
    readonly tested: boolean
  }
  | {
    readonly kind: 'learning-recorded'
    readonly missionId: string
    readonly revision: number
    readonly learning: MissionLearning
  }
  | { readonly kind: 'verification-started'; readonly missionId: string; readonly revision: number; readonly status: 'VERIFYING' }
  | {
    readonly kind: 'judge'
    readonly missionId: string
    readonly revision: number
    readonly decision: MissionJudgeDecision
    readonly status: 'ACTIVE' | 'WAITING_EXTERNAL' | 'VERIFYING' | 'DONE'
    readonly quality?: MissionQualityGate
    readonly terminalReason?: MissionTerminalReason
  }
  | {
    readonly kind: 'replanned'
    readonly missionId: string
    readonly revision: number
    readonly reason: string
    readonly status: 'ACTIVE'
  }
  | {
    readonly kind: 'cancelled'
    readonly missionId: string
    readonly revision: number
    readonly status: 'DONE'
    readonly terminalReason: 'user_cancelled'
  }
  | { readonly kind: 'resumed'; readonly missionId: string; readonly revision: number; readonly status: 'ACTIVE' }

declare module '@phoenix-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Mission Persistence Kernel state transition; never contains credentials or raw arguments. */
    'hardness/kernel': MissionKernelEvent
  }
}

/** Durable sink used by the kernel. */
export interface MissionKernelWriter {
  record(event: MissionKernelEvent): void
}

/**
 * Create a kernel writer backed by the owning durable session.
 * @param session - Durable session that owns the mission.
 * @returns A writer that appends kernel events to the session.
 */
export function createMissionKernelWriter(session: Session): MissionKernelWriter {
  return { record: event => session.append('hardness/kernel', event) }
}

const MAX_TEXT = 500
const MAX_ITEMS = 8
const CRITERION_ORDER: readonly MissionCriterionStatus[] = ['PENDING', 'IMPLEMENTED', 'TESTED', 'VERIFIED']

function text(value: string, field: string): string {
  const result = value.trim()
  if (result.length === 0 || result.length > MAX_TEXT) throw new TypeError(`invalid mission ${field}`)
  return result
}

function list(values: readonly string[], field: string): readonly string[] {
  if (values.length > MAX_ITEMS) throw new TypeError(`too many mission ${field} entries`)
  return Object.freeze(values.map(value => text(value, field)))
}

function route(value: MissionRoute): MissionRoute {
  return Object.freeze({
    id: text(value.id, 'route id'), strategy: text(value.strategy, 'strategy'),
    rationale: text(value.rationale, 'route rationale'),
    priority: Number.isSafeInteger(value.priority) ? value.priority : 0,
  })
}

function goal(value: MissionGoalLock): MissionGoalLock {
  const criteria = value.acceptanceCriteria.slice(0, MAX_ITEMS).map(item => Object.freeze({
    id: text(item.id, 'criterion id'), description: text(item.description, 'criterion description'), mandatory: item.mandatory,
  }))
  if (criteria.length === 0 || !criteria.some(item => item.mandatory)) throw new TypeError('mission requires a mandatory acceptance criterion')
  if (new Set(criteria.map(item => item.id)).size !== criteria.length) throw new TypeError('mission criterion ids must be unique')
  return Object.freeze({
    objective: text(value.objective, 'objective'),
    deliverables: Object.freeze(value.deliverables.slice(0, MAX_ITEMS).map(item => Object.freeze({
      id: text(item.id, 'deliverable id'), description: text(item.description, 'deliverable description'),
    }))),
    acceptanceCriteria: Object.freeze(criteria), qualityRequirements: list(value.qualityRequirements, 'quality requirement'),
  })
}

function emptyGoal(): MissionGoalLock {
  return goal({
    objective: 'Uninitialized mission', deliverables: [{ id: 'mission-output', description: 'Mission output' }],
    acceptanceCriteria: [{ id: 'mission-goal', description: 'The mission goal is verified', mandatory: true }],
    qualityRequirements: ['Evidence is independently reproducible'],
  })
}

function criteriaFor(value: MissionGoalLock): readonly MissionCriterion[] {
  return Object.freeze(value.acceptanceCriteria.map(item => Object.freeze({ ...item, status: 'PENDING' as const, evidence: Object.freeze([]) })))
}

function initial(missionId: string, revision: number, lockedGoal: MissionGoalLock = emptyGoal()): MissionKernelState {
  return {
    missionId: text(missionId, 'id'), revision, status: 'ACTIVE', goal: lockedGoal, criteria: criteriaFor(lockedGoal),
    attempts: 0, failures: 0, routes: [], learnings: [],
  }
}

function quality(value: MissionQualityGate): MissionQualityGate {
  return Object.freeze({ verdict: value.verdict, summary: text(value.summary, 'quality summary'),
    evidence: list(value.evidence, 'quality evidence'), findings: list(value.findings, 'quality finding') })
}

function criterionReview(value: MissionCriterionReview): MissionCriterionReview {
  return Object.freeze({ id: text(value.id, 'judge criterion id'), verdict: value.verdict,
    evidence: list(value.evidence, 'judge criterion evidence'), findings: list(value.findings, 'judge criterion finding') })
}

function decision(value: MissionJudgeDecision): MissionJudgeDecision {
  const candidateCriteria = value.criteria
  const candidateQuality = value.quality
  return Object.freeze({ verdict: value.verdict, summary: text(value.summary, 'judge summary'),
    evidence: list(value.evidence, 'judge evidence'), requiredChanges: list(value.requiredChanges, 'judge required change'),
    criteria: Object.freeze(candidateCriteria.slice(0, MAX_ITEMS).map(criterionReview)), quality: quality(candidateQuality) })
}

function reviewChanges(state: MissionKernelState, candidate: MissionJudgeDecision): string[] {
  const changes = [...candidate.requiredChanges]
  for (const criterion of state.criteria) {
    if (!criterion.mandatory) continue
    const review = candidate.criteria.find(item => item.id === criterion.id)
    if (criterion.status !== 'VERIFIED') changes.push(`verify criterion ${criterion.id}`)
    if (review === undefined || review.verdict !== 'pass' || review.evidence.length === 0) changes.push(`judge criterion ${criterion.id} with evidence`)
  }
  if (candidate.quality.verdict !== 'pass' || candidate.quality.evidence.length === 0) changes.push('satisfy the quality gate with independent evidence')
  return [...new Set(changes)].slice(0, MAX_ITEMS)
}

function canPass(state: MissionKernelState, candidate: MissionJudgeDecision): boolean {
  if (candidate.verdict !== 'pass' || candidate.evidence.length === 0 || candidate.quality.verdict !== 'pass' || candidate.quality.evidence.length === 0) return false
  return state.criteria.filter(item => item.mandatory).every((item) => {
    const review = candidate.criteria.find(value => value.id === item.id)
    return (item.status === 'TESTED' || item.status === 'VERIFIED') && review?.verdict === 'pass' && review.evidence.length > 0
  })
}

/** Mission state machine that survives process restarts through replayable events. */
export class MissionPersistenceKernel {
  private state: MissionKernelState
  private started = false

  /** @param input - mission identity, locked goal, and durable event sink. */
  constructor(
    private readonly input: {
      readonly missionId: string
      readonly revision: number
      readonly goal: MissionGoalLock
      readonly writer: MissionKernelWriter
    },
    prior: readonly MissionKernelEvent[] = [],
  ) {
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new TypeError('invalid mission revision')
    this.input = { ...input, goal: goal(input.goal) }
    this.state = replayMissionKernel(prior, input.missionId, input.revision, initial(input.missionId, input.revision, this.input.goal))
    this.started = prior.some(event => event.kind === 'started')
  }

  /** Return the current durable state snapshot reconstructed from recorded events.
   * @returns The current durable state snapshot.
   */
  snapshot(): MissionKernelState { return this.state }

  /** Start the mission once; repeated starts are idempotent.
   * @returns The active state.
   */
  start(): MissionKernelState {
    if (this.started) return this.state
    this.emit({ kind: 'started', missionId: this.input.missionId, revision: this.input.revision, status: 'ACTIVE', goal: this.input.goal })
    this.started = true
    return this.state
  }

  /** Record a disposable failure and activate recovery without closing the mission.
   * @param input - Failure scope, strategy, cause, fingerprint, and alternative routes.
   * @returns Updated state.
   */
  fail(input: {
    readonly scope: MissionFailureScope
    readonly strategy: string
    readonly cause: string
    readonly rootCause: string
    readonly fingerprint: string
    readonly blocked?: boolean
    readonly routes: readonly MissionRoute[]
  }): MissionKernelState {
    this.assertOpen()
    const fingerprint = text(input.fingerprint, 'failure fingerprint')
    const strategy = text(input.strategy, 'strategy')
    const repeated = this.state.lastFailureFingerprint === fingerprint
    const status = input.blocked === true ? 'WAITING_EXTERNAL' : 'RECOVERING'
    this.emit({ kind: 'failure', missionId: this.input.missionId, revision: this.input.revision, scope: input.scope, strategy,
      cause: text(input.cause, 'cause'), rootCause: text(input.rootCause, 'root cause'), fingerprint, repeated, status })
    if (input.blocked === true) this.emit({ kind: 'wall-opened', missionId: this.input.missionId, revision: this.input.revision,
      reason: text(input.rootCause, 'wall reason'), status })
    this.propose(input.routes)
    const nextRoute = input.routes.toSorted((left, right) => left.priority - right.priority)[0]
    this.recordLearning({
      fingerprint,
      solution: nextRoute === undefined
        ? 'Replan with a materially different strategy before retrying.'
        : `Try strategy ${text(nextRoute.strategy, 'strategy')} next: ${text(nextRoute.rationale, 'route rationale')}`,
      evidence: [text(input.rootCause, 'root cause'), ...(nextRoute === undefined ? [] : [text(nextRoute.id, 'route id')])],
    })
    return this.state
  }

  /** Open WALL_PROTOCOL for an unavailable external dependency.
   * @param dependency - Stable name of the unavailable dependency.
   * @param detail - Exact information required before resumption.
   * @returns The waiting state.
   */
  dependencyMissing(dependency: string, detail: string): MissionKernelState {
    this.assertOpen()
    const name = text(dependency, 'dependency')
    const exactDetail = text(detail, 'dependency detail')
    this.emit({ kind: 'dependency-missing', missionId: this.input.missionId, revision: this.input.revision, dependency: name, detail: exactDetail })
    this.emit({ kind: 'wall-opened', missionId: this.input.missionId, revision: this.input.revision,
      reason: `external dependency unavailable: ${name}; ${exactDetail}`, status: 'WAITING_EXTERNAL', missingDependency: name })
    return this.state
  }

  /** Register a skill after it has been tested; ATLAS remains the source of truth.
   * @param skillId - Stable skill identifier.
   * @param tested - Whether the skill passed its validation run.
   * @returns Current state.
   */
  skillRegistered(skillId: string, tested: boolean): MissionKernelState {
    this.assertOpen()
    this.emit({ kind: 'skill-registered', missionId: this.input.missionId, revision: this.input.revision, skillId: text(skillId, 'skill id'), tested })
    return this.state
  }

  /** Record a reusable failure-to-solution memory.
   * @param value - Failure fingerprint, solution, and supporting evidence.
   * @returns Current state.
   */
  recordLearning(value: MissionLearning): MissionKernelState {
    this.assertOpen()
    this.emit({ kind: 'learning-recorded', missionId: this.input.missionId, revision: this.input.revision,
      learning: Object.freeze({ fingerprint: text(value.fingerprint, 'learning fingerprint'), solution: text(value.solution, 'learning solution'), evidence: list(value.evidence, 'learning evidence') }) })
    return this.state
  }

  /** Advance one criterion through the required evidence states.
   * @param criterionId - Stable criterion identifier.
   * @param status - Next evidence state after the current state.
   * @param evidence - Durable references proving the transition.
   * @returns Current state.
   */
  markCriterion(criterionId: string, status: Exclude<MissionCriterionStatus, 'PENDING'>, evidence: readonly string[]): MissionKernelState {
    this.assertOpen()
    const current = this.state.criteria.find(item => item.id === criterionId)
    if (current === undefined) throw new Error(`unknown mission criterion: ${criterionId}`)
    const nextIndex = CRITERION_ORDER.indexOf(status)
    const currentIndex = CRITERION_ORDER.indexOf(current.status)
    if (nextIndex !== currentIndex + 1) throw new Error(`criterion ${criterionId} must advance from ${current.status} to the next evidence state`)
    const references = list(evidence, 'criterion evidence')
    if (references.length === 0) throw new TypeError(`criterion ${criterionId} requires evidence`)
    this.emit({ kind: 'criterion', missionId: this.input.missionId, revision: this.input.revision,
      criterionId: text(criterionId, 'criterion id'), status, evidence: references })
    return this.state
  }

  /** Propose bounded alternatives after root-cause analysis.
   * @param routes - Candidate routes ordered by their declared priority.
   * @returns Current state.
   */
  propose(routes: readonly MissionRoute[]): MissionKernelState {
    this.assertOpen()
    const normalized = routes.slice(0, MAX_ITEMS).map(route)
    if (normalized.length === 0) return this.state
    this.emit({ kind: 'routes-proposed', missionId: this.input.missionId, revision: this.input.revision, routes: normalized })
    return this.state
  }

  /** Select a route, forcing a different strategy after a repeated failure.
   * @param routeId - Identifier of the proposed route to select.
   * @returns Current state.
   */
  select(routeId: string): MissionKernelState {
    this.assertOpen()
    const selected = this.state.routes.find(item => item.id === routeId)
    if (selected === undefined) throw new Error(`unknown mission route: ${routeId}`)
    if (this.state.lastFailureFingerprint !== undefined && this.state.lastFailureStrategy === selected.strategy) throw new Error('repeated mission failure requires a different strategy')
    this.emit({ kind: 'route-selected', missionId: this.input.missionId, revision: this.input.revision, routeId: selected.id, strategy: selected.strategy })
    return this.state
  }

  /**
   * Apply an independent judge. A pass is accepted only with verified criteria,
   * criterion-level evidence, and a passing quality gate.
   * @param value - Structured judge decision.
   * @returns The judged mission state.
   */
  judge(value: MissionJudgeDecision): MissionKernelState {
    this.assertOpen()
    const candidate = decision(value)
    const accepted = canPass(this.state, candidate)
    const normalized = accepted ? candidate : candidate.verdict === 'blocked' ? candidate : Object.freeze({ ...candidate,
      verdict: 'needs_changes' as const,
      summary: candidate.verdict === 'pass' ? `Judge pass rejected: ${reviewChanges(this.state, candidate).join('; ')}` : candidate.summary,
      requiredChanges: Object.freeze(reviewChanges(this.state, candidate)) })
    const status = normalized.verdict === 'blocked' ? 'WAITING_EXTERNAL' : accepted ? 'DONE' : 'ACTIVE'
    this.emit({ kind: 'judge', missionId: this.input.missionId, revision: this.input.revision, decision: normalized, status, quality: normalized.quality,
      ...(accepted ? { terminalReason: 'verified' as const } : {}) })
    if (status === 'WAITING_EXTERNAL') this.emit({ kind: 'wall-opened', missionId: this.input.missionId,
      revision: this.input.revision, reason: normalized.summary, status })
    // A repair decision invalidates the candidate's criterion progress. Keep
    // the judge and learning records, but make the next strategy prove a new
    // candidate from PENDING instead of inheriting stale evidence.
    if (status === 'ACTIVE') this.emit({ kind: 'replanned', missionId: this.input.missionId, revision: this.input.revision,
      reason: normalized.summary, status })
    if (status !== 'DONE') {
      this.recordLearning({
        fingerprint: `judge:${normalized.verdict}`,
        solution: normalized.requiredChanges.length === 0
          ? 'Collect stronger criterion and quality evidence before requesting another review.'
          : normalized.requiredChanges.join('; '),
        evidence: normalized.evidence.length === 0 ? [normalized.summary] : normalized.evidence,
      })
    }
    return this.state
  }

  /** Mark the durable checkpoint immediately before independent review.
   * @returns VERIFYING state.
   */
  beginVerification(): MissionKernelState {
    this.assertOpen()
    this.emit({ kind: 'verification-started', missionId: this.input.missionId, revision: this.input.revision, status: 'VERIFYING' })
    return this.state
  }

  /** Resume a waiting mission after its dependency becomes available.
   * @returns Active state.
   */
  resume(): MissionKernelState {
    if (this.state.status === 'DONE') throw new Error('mission is not resumable')
    this.emit({ kind: 'resumed', missionId: this.input.missionId, revision: this.input.revision, status: 'ACTIVE' })
    return this.state
  }

  /** Cancel only by explicit user authority.
   * @returns DONE with a cancellation reason.
   */
  cancel(): MissionKernelState {
    if (this.state.status === 'DONE') throw new Error('completed mission cannot be cancelled')
    this.emit({ kind: 'cancelled', missionId: this.input.missionId, revision: this.input.revision, status: 'DONE', terminalReason: 'user_cancelled' })
    return this.state
  }

  private assertOpen(): void {
    if (this.state.status === 'DONE') throw new Error('mission is closed')
  }

  private emit(event: MissionKernelEvent): void {
    this.input.writer.record(event)
    this.state = replayMissionKernel([event], this.input.missionId, this.input.revision, this.state)
  }
}

/** Replay kernel events for one exact mission identity.
 * @param events - Kernel events in durable log order.
 * @param missionId - Exact mission identity to replay.
 * @param revision - Exact mission revision to replay.
 * @param seed - Optional state used as the replay starting point.
 * @returns Reconstructed state.
 */
export function replayMissionKernel(
  events: readonly MissionKernelEvent[],
  missionId: string,
  revision: number,
  seed: MissionKernelState = initial(missionId, revision),
): MissionKernelState {
  let state = seed
  for (const event of events) {
    if (event.missionId !== missionId || event.revision !== revision) continue
    switch (event.kind) {
      case 'started': state = { ...state, status: 'ACTIVE', goal: event.goal, criteria: criteriaFor(event.goal) }; break
      case 'failure': state = {
        ...state,
        status: event.status,
        attempts: state.attempts + 1,
        failures: state.failures + 1,
        lastFailureFingerprint: event.fingerprint,
        lastFailureCause: event.cause,
        lastFailureStrategy: event.strategy,
        lastRootCause: event.rootCause,
      }; break
      case 'routes-proposed': state = { ...state, routes: event.routes }; break
      case 'route-selected': state = { ...state, selectedRoute: event.routeId }; break
      case 'criterion': state = { ...state, criteria: state.criteria.map(item => item.id === event.criterionId ? { ...item, status: event.status, evidence: event.evidence } : item) }; break
      case 'dependency-missing': state = { ...state, status: 'WAITING_EXTERNAL', missingDependency: event.dependency, lastRootCause: event.detail }; break
      case 'judge': state = { ...state, status: event.status, judge: event.decision,
        ...(event.quality === undefined ? {} : { quality: event.quality }),
        criteria: event.status === 'DONE' && event.terminalReason === 'verified'
          ? state.criteria.map(item => item.mandatory ? { ...item, status: 'VERIFIED' as const,
            evidence: event.decision.criteria.find(review => review.id === item.id)?.evidence ?? item.evidence } : item)
          : state.criteria,
        ...(event.terminalReason === undefined ? {} : { terminalReason: event.terminalReason }) }; break
      case 'replanned': state = { ...state, status: 'ACTIVE', criteria: criteriaFor(state.goal) }; break
      case 'cancelled': state = { ...state, status: 'DONE', terminalReason: 'user_cancelled' }; break
      case 'resumed': {
        const { missingDependency, ...withoutDependency } = state
        void missingDependency
        state = { ...withoutDependency, status: 'ACTIVE' }
        break
      }
      case 'wall-opened': state = { ...state, status: event.status, ...(event.missingDependency === undefined ? {} : { missingDependency: event.missingDependency }) }; break
      case 'learning-recorded': state = { ...state, learnings: [...state.learnings, event.learning] }; break
      case 'verification-started': state = { ...state, status: 'VERIFYING' }; break
      case 'skill-registered': break
    }
  }
  return state
}

/** Replay the kernel rows from one durable session.
 * @param events - Session events containing kernel rows.
 * @param missionId - Exact mission identity to replay.
 * @param revision - Exact mission revision to replay.
 * @returns Reconstructed state.
 */
export function replayMissionKernelSession(events: readonly SessionEvent[], missionId: CallId, revision: number): MissionKernelState {
  const rows = events.filter((event): event is SessionEvent<'hardness/kernel'> => event.type === 'hardness/kernel' && event.data.missionId === missionId && event.data.revision === revision).map(event => event.data)
  return replayMissionKernel(rows, missionId, revision)
}
