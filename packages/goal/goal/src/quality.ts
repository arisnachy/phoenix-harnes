import { randomUUID } from 'node:crypto'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { Branded } from '@phoenix-ai/dsh-brand'
import type { SessionEvent } from '@phoenix-ai/dsh-session'

export type QualityAssessmentId = Branded<'QualityAssessmentId'>
export type QualityTaskClass = 'conversational' | 'bounded' | 'substantial' | 'living'
export type QualityCriterionTier = 'requested' | 'professional' | 'excellent'
export type QualityCriterionStatus = 'pending' | 'implemented' | 'tested' | 'verified' | 'failed' | 'blocked_external'
export type QualityScenarioSeverity = 'low' | 'medium' | 'high' | 'critical'
export type QualityScenarioStatus = 'pending' | 'pass' | 'fail' | 'untested' | 'accepted-risk'
export type QualityEvidenceKind = 'static' | 'simulated' | 'live'
export type QualityLikelihood = 'low' | 'medium' | 'high'
export type QualityConfidence = 'low' | 'medium' | 'high'
export type QualityImpact = 'low' | 'medium' | 'high' | 'critical'
export type RiskForecastStatus = 'open' | 'mitigated' | 'accepted' | 'confirmed' | 'contradicted' | 'unknown'
export type QualityInnovationStatus = 'pending' | 'implemented' | 'offered' | 'not-applicable'

export interface QualityAssessmentRef {
  readonly id: QualityAssessmentId
  readonly revision: number
}

export interface QualityCriterion {
  readonly id: string
  readonly text: string
  readonly tier: QualityCriterionTier
  readonly mandatory: boolean
  readonly status: QualityCriterionStatus
  readonly evidence: readonly string[]
}

export interface QualityScenario {
  readonly id: string
  readonly title: string
  readonly severity: QualityScenarioSeverity
  readonly status: QualityScenarioStatus
  readonly evidenceKind?: QualityEvidenceKind
  readonly evidence: readonly string[]
  readonly blocker?: string
}

export interface RiskForecast {
  readonly id: string
  readonly scenario: string
  readonly likelihood: QualityLikelihood
  readonly confidence: QualityConfidence
  readonly impact: QualityImpact
  readonly evidence: readonly string[]
  readonly mitigation: string
  readonly status: RiskForecastStatus
  readonly detectability?: 'low' | 'medium' | 'high'
}

export interface QualityInnovation {
  readonly status: QualityInnovationStatus
  readonly rationale: string
  readonly evidence?: readonly string[]
}

export interface QualityAssessmentSnapshot {
  readonly id: QualityAssessmentId
  readonly revision: number
  readonly objective: string
  readonly taskClass: QualityTaskClass
  readonly goalId?: string
  readonly goalRevision?: number
  criteria: QualityCriterion[]
  scenarios: QualityScenario[]
  forecasts: RiskForecast[]
  requiredChanges: string[]
  innovation?: QualityInnovation
  readonly createdAt: number
  readonly updatedAt: number
}

export interface QualityReadiness {
  readonly ready: boolean
  readonly blockers: readonly string[]
}

export interface StartQualityAssessmentRequest {
  readonly objective: string
  readonly taskClass: QualityTaskClass
  readonly goalId?: string
  readonly goalRevision?: number
}

export type QualityMutation =
  | { readonly kind: 'criterion'; readonly criterion: QualityCriterion }
  | { readonly kind: 'scenario'; readonly scenario: QualityScenario }
  | { readonly kind: 'forecast'; readonly forecast: RiskForecast }
  | { readonly kind: 'required-change'; readonly value: string; readonly resolved?: boolean }
  | { readonly kind: 'innovation'; readonly innovation: QualityInnovation }

export interface QualityChangeMeta {
  readonly kind: 'quality/change'
  readonly version: 1
  readonly operation: 'start' | 'record'
  readonly assessment: QualityAssessmentSnapshot
}

declare module '@phoenix-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-snapshot quality assessment for one exact mission revision. */
    'quality/change': QualityChangeMeta
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalizedText(value: string, label: string): string {
  const text = value.trim()
  if (text.length === 0) throw new TypeError(`${label} must be a non-empty string`)
  return text
}

function nextTime(previous?: number): number {
  return previous === undefined ? Date.now() : Math.max(Date.now(), previous)
}

function replaceById<T extends { readonly id: string }>(values: readonly T[], value: T): T[] {
  const next = values.filter(item => item.id !== value.id).map(clone)
  next.push(clone(value))
  return next
}

/** Pure last-wins replay of the durable quality stream. */
export function foldQuality(events: readonly SessionEvent[]): QualityAssessmentSnapshot | undefined {
  let current: QualityAssessmentSnapshot | undefined
  for (const event of events) {
    if (event.type !== 'quality/change') continue
    current = clone(event.data.assessment)
  }
  return current
}

function scenarioResolved(scenario: QualityScenario): boolean {
  if (scenario.severity !== 'high' && scenario.severity !== 'critical') return true
  return scenario.status === 'pass' || scenario.status === 'accepted-risk'
}

function forecastResolved(forecast: RiskForecast): boolean {
  if (forecast.impact !== 'high' && forecast.impact !== 'critical') return true
  return forecast.status !== 'open'
}

/**
 * Pure Definition-of-Done predicate for one revision-bound quality assessment.
 * Predictions remain hypotheses: this function only asks whether material
 * risks are mitigated/accepted, never whether a forecast was "true".
 */
export function qualityReadiness(snapshot: QualityAssessmentSnapshot): QualityReadiness {
  const blockers: string[] = []

  for (const criterion of snapshot.criteria) {
    if (criterion.mandatory && criterion.status !== 'verified') {
      blockers.push(`criterion ${criterion.id} is ${criterion.status}`)
    }
  }
  for (const scenario of snapshot.scenarios) {
    if (!scenarioResolved(scenario)) blockers.push(`scenario ${scenario.id} is ${scenario.status}`)
  }
  for (const forecast of snapshot.forecasts) {
    if (!forecastResolved(forecast)) blockers.push(`forecast ${forecast.id} is open with ${forecast.impact} impact`)
  }
  for (const change of snapshot.requiredChanges) blockers.push(`required change: ${change}`)

  if ((snapshot.taskClass === 'substantial' || snapshot.taskClass === 'living')
    && (snapshot.innovation === undefined || snapshot.innovation.status === 'pending')) {
    blockers.push('innovation disposition is pending')
  }

  return { ready: blockers.length === 0, blockers }
}

/** Durable, replayable quality ledger sharing the owning Agent session log. */
export class QualityLedger {
  get(agent: Agent): QualityAssessmentSnapshot | undefined {
    const current = foldQuality(agent.session.events)
    return current === undefined ? undefined : clone(current)
  }

  start(agent: Agent, request: StartQualityAssessmentRequest): QualityAssessmentSnapshot {
    const objective = normalizedText(request.objective, 'quality objective')
    if ((request.goalId === undefined) !== (request.goalRevision === undefined)) {
      throw new TypeError('goalId and goalRevision must be supplied together')
    }
    if (request.goalRevision !== undefined && (!Number.isSafeInteger(request.goalRevision) || request.goalRevision < 1)) {
      throw new TypeError('goalRevision must be a positive safe integer')
    }
    const now = nextTime()
    const assessment: QualityAssessmentSnapshot = {
      id: `quality-${randomUUID()}` as QualityAssessmentId,
      revision: 1,
      objective,
      taskClass: request.taskClass,
      ...request.goalId === undefined ? {} : { goalId: normalizedText(request.goalId, 'goalId'), goalRevision: request.goalRevision },
      criteria: [],
      scenarios: [],
      forecasts: [],
      requiredChanges: [],
      createdAt: now,
      updatedAt: now,
    }
    agent.session.append('quality/change', {
      kind: 'quality/change', version: 1, operation: 'start', assessment: clone(assessment),
    })
    return clone(assessment)
  }

  record(agent: Agent, ref: QualityAssessmentRef, mutation: QualityMutation): QualityAssessmentSnapshot {
    const current = this.get(agent)
    if (current === undefined) throw new Error('quality assessment not found')
    if (current.id !== ref.id || current.revision !== ref.revision) {
      throw new Error(`stale quality revision: expected ${current.id}@${current.revision}`)
    }

    const next: QualityAssessmentSnapshot = {
      ...clone(current),
      revision: current.revision + 1,
      updatedAt: nextTime(current.updatedAt),
    }
    if (mutation.kind === 'criterion') next.criteria = replaceById(next.criteria, mutation.criterion)
    if (mutation.kind === 'scenario') next.scenarios = replaceById(next.scenarios, mutation.scenario)
    if (mutation.kind === 'forecast') next.forecasts = replaceById(next.forecasts, mutation.forecast)
    if (mutation.kind === 'required-change') {
      const value = normalizedText(mutation.value, 'required change')
      next.requiredChanges = mutation.resolved
        ? next.requiredChanges.filter(item => item !== value)
        : [...new Set([...next.requiredChanges, value])]
    }
    if (mutation.kind === 'innovation') next.innovation = clone(mutation.innovation)

    agent.session.append('quality/change', {
      kind: 'quality/change', version: 1, operation: 'record', assessment: clone(next),
    })
    return clone(next)
  }
}

const qualityByGoalRuntime = new WeakMap<object, QualityLedger>()

/** Return the one process-local QualityLedger facade for an owning goal runtime. */
export function goalQualityLedger(owner: object): QualityLedger {
  let ledger = qualityByGoalRuntime.get(owner)
  if (ledger !== undefined) return ledger
  ledger = new QualityLedger()
  qualityByGoalRuntime.set(owner, ledger)
  return ledger
}
