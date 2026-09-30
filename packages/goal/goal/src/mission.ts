/**
 * Durable master-plan ledger for long-running PHOENIX goals.
 *
 * The goal domain remains the lifecycle authority. This companion event keeps
 * the compact plan that must survive context compaction, process restart, and
 * autonomous continuation without duplicating the goal state machine.
 * @module @phoenix-ai/dsh-goal/mission
 */

import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import type { GoalId, GoalView } from './types.ts'

/** Status of one bounded master-plan step. */
export type GoalMissionStepStatus = 'pending' | 'active' | 'done' | 'blocked'

/** One durable work item in the mission master plan. */
export interface GoalMissionStep {
  /** Stable plan-local id. */
  readonly id: string
  /** Concrete work description. */
  readonly title: string
  /** Current execution state. */
  readonly status: GoalMissionStepStatus
  /** Optional durable child-agent ownership hint. */
  readonly ownerAgentId?: string
  /** Optional non-overlapping relative write scopes assigned to that worker. */
  readonly writeScope?: readonly string[]
}

/** Whole durable master plan for one goal. */
export interface GoalMissionPlan {
  /** Stable owning goal id. */
  readonly goalId: GoalId
  /** Goal revision current when this plan version was written. */
  readonly goalRevision: number
  /** Independent positive plan revision used for compare-and-set updates. */
  readonly planRevision: number
  /** Goal objective copied for compaction-safe recovery. */
  readonly objective: string
  /** Explicit acceptance criteria that define DONE. */
  readonly acceptanceCriteria: readonly string[]
  /** Ordered bounded execution plan. */
  readonly steps: readonly GoalMissionStep[]
  /** Material decisions that should survive context compaction. */
  readonly decisions: readonly string[]
  /** Epoch milliseconds of this plan mutation. */
  readonly updatedAt: number
}

/** Input for replacing the bounded mission master plan. */
export interface GoalMissionPlanRequest {
  readonly acceptanceCriteria: readonly string[]
  readonly steps: readonly GoalMissionStep[]
  readonly decisions?: readonly string[]
}

/** Full-snapshot durable event for the mission plan. */
export interface GoalMissionPlanChange {
  readonly kind: 'goal/mission-plan'
  readonly version: 1
  readonly plan: GoalMissionPlan
}

declare module '@phoenix-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Latest compact master plan for a long-running goal. */
    'goal/mission-plan': GoalMissionPlanChange
  }
}

const MAX_STEPS = 32
const MAX_CRITERIA = 32
const MAX_DECISIONS = 16
const MAX_TEXT = 1_000
const MAX_SCOPE = 160

function text(value: string, field: string, max = MAX_TEXT): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > max) {
    throw new TypeError(`mission plan ${field} must be 1..${String(max)} normalized characters`)
  }
  return normalized
}

function stringList(values: readonly string[], field: string, maxItems: number): string[] {
  if (values.length > maxItems) throw new TypeError(`mission plan ${field} exceeds ${String(maxItems)} items`)
  return values.map((value, index) => text(value, `${field}[${String(index)}]`))
}

function scopeList(values: readonly string[] | undefined, field: string): string[] | undefined {
  if (values === undefined) return undefined
  if (values.length === 0 || values.length > 16) throw new TypeError(`mission plan ${field} must contain 1..16 scopes`)
  return values.map((value, index) => {
    const normalized = text(value.replaceAll('\\', '/'), `${field}[${String(index)}]`, MAX_SCOPE)
    if (normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized) || normalized.split('/').includes('..')) {
      throw new TypeError(`mission plan ${field} must contain relative workspace scopes`)
    }
    return normalized.replace(/^\.\//u, '').replace(/\/$/u, '')
  })
}

function normalizedSteps(steps: readonly GoalMissionStep[]): GoalMissionStep[] {
  if (steps.length > MAX_STEPS) throw new TypeError(`mission plan steps exceeds ${String(MAX_STEPS)} items`)
  const ids = new Set<string>()
  return steps.map((step, index) => {
    const id = text(step.id, `steps[${String(index)}].id`, 80)
    if (ids.has(id)) throw new TypeError(`mission plan step id "${id}" is duplicated`)
    ids.add(id)
    if (!['pending', 'active', 'done', 'blocked'].includes(step.status)) {
      throw new TypeError(`mission plan step "${id}" has an invalid status`)
    }
    const ownerAgentId = step.ownerAgentId === undefined
      ? undefined
      : text(step.ownerAgentId, `steps[${String(index)}].ownerAgentId`, 200)
    const writeScope = scopeList(step.writeScope, `steps[${String(index)}].writeScope`)
    return {
      id,
      title: text(step.title, `steps[${String(index)}].title`),
      status: step.status,
      ...ownerAgentId === undefined ? {} : { ownerAgentId },
      ...writeScope === undefined ? {} : { writeScope },
    }
  })
}

/**
 * Materialize the next bounded plan revision against the exact live goal.
 * @param goal - current live goal.
 * @param previous - latest durable plan for this goal, when present.
 * @param request - complete replacement master plan.
 * @param now - deterministic mutation timestamp.
 * @returns validated whole plan snapshot.
 */
export function nextGoalMissionPlan(
  goal: Pick<GoalView, 'id' | 'revision' | 'objective'>,
  previous: GoalMissionPlan | undefined,
  request: GoalMissionPlanRequest,
  now: number,
): GoalMissionPlan {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('mission plan updatedAt must be a non-negative safe integer')
  if (previous !== undefined && previous.goalId !== goal.id) throw new TypeError('mission plan belongs to another goal')
  return {
    goalId: goal.id,
    goalRevision: goal.revision,
    planRevision: (previous?.planRevision ?? 0) + 1,
    objective: text(goal.objective, 'objective'),
    acceptanceCriteria: stringList(request.acceptanceCriteria, 'acceptanceCriteria', MAX_CRITERIA),
    steps: normalizedSteps(request.steps),
    decisions: stringList(request.decisions ?? [], 'decisions', MAX_DECISIONS),
    updatedAt: now,
  }
}

/**
 * Replay the latest valid mission-plan snapshot for one goal.
 * @param events - durable session events.
 * @param goalId - owning goal identity.
 * @returns latest plan snapshot, when present.
 */
export function replayGoalMissionPlan(
  events: readonly SessionEvent[],
  goalId: GoalId | string,
): GoalMissionPlan | undefined {
  const event = events.findLast((candidate): candidate is SessionEvent<'goal/mission-plan'> =>
    candidate.type === 'goal/mission-plan'
    && candidate.data.kind === 'goal/mission-plan'
    && candidate.data.version === 1
    && candidate.data.plan.goalId === goalId)
  return event?.data.plan
}

/**
 * Persist one already validated whole master-plan snapshot.
 * @param session - owning durable session.
 * @param plan - plan produced by {@link nextGoalMissionPlan}.
 */
export function recordGoalMissionPlan(session: Session, plan: GoalMissionPlan): void {
  // Re-validate through the public constructor shape before trusting callers.
  const validated = nextGoalMissionPlan(
    { id: plan.goalId, revision: plan.goalRevision, objective: plan.objective },
    plan.planRevision === 1 ? undefined : { ...plan, planRevision: plan.planRevision - 1 },
    {
      acceptanceCriteria: plan.acceptanceCriteria,
      steps: plan.steps,
      decisions: plan.decisions,
    },
    plan.updatedAt,
  )
  if (validated.planRevision !== plan.planRevision) throw new TypeError('mission plan revision is not canonical')
  session.append('goal/mission-plan', {
    kind: 'goal/mission-plan',
    version: 1,
    plan,
  })
}
