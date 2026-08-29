import { randomUUID } from 'node:crypto'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { Session, SessionEvent } from '@phoenix-ai/dsh-session'
import type {
  SpecialistChange, SpecialistExperiment, SpecialistJudge, SpecialistPhase,
  SpecialistProfile, SpecialistSource,
} from './domain.ts'

/** Input used to create one persistent specialist laboratory. */
export interface StartSpecialistRequest {
  readonly topic: string
  readonly objective: string
  readonly successCriteria: readonly string[]
  readonly maxIterations?: number
}

/** One source registration accepted by the specialist ledger. */
export interface AddSpecialistSourceRequest {
  readonly title: string
  readonly locator: string
}

/** One reproducible experiment registration accepted by the specialist ledger. */
export interface AddSpecialistExperimentRequest {
  readonly name: string
  readonly dataset: string
}

/** One judge result that decides whether a specialist may be declared ready. */
export interface EvaluateSpecialistRequest {
  readonly score: number
  readonly passed: boolean
  readonly blocked?: boolean
  readonly summary: string
  readonly requiredChanges?: readonly string[]
}

const DEFAULT_MAX_ITERATIONS = 8

function text(value: string, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be non-empty`)
  return value.trim()
}

function list(values: readonly string[], field: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) throw new TypeError(`${field} must not be empty`)
  return values.map((value, index) => text(value, `${field}[${index}]`))
}

function maxIterations(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_ITERATIONS
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new TypeError('maxIterations must be a positive safe integer')
  return resolved
}

function profileFromEvent(event: SessionEvent): SpecialistProfile | undefined {
  if (event.type !== 'specialist/change') return undefined
  const value = event.data as SpecialistChange
  if (value.kind !== 'specialist/change' || value.version !== 1 || typeof value.specialist?.id !== 'string') return undefined
  return value.specialist
}

/** Replay all specialist laboratories from durable session events. */
export function foldSpecialists(events: readonly SessionEvent[]): ReadonlyMap<string, SpecialistProfile> {
  const profiles = new Map<string, SpecialistProfile>()
  for (const event of events) {
    const profile = profileFromEvent(event)
    if (profile !== undefined) profiles.set(profile.id, profile)
  }
  return profiles
}

function nextPhase(operation: SpecialistChange['operation']): SpecialistPhase {
  switch (operation) {
    case 'start': return 'scoping'
    case 'source': return 'researching'
    case 'hypothesis': return 'hypothesizing'
    case 'experiment': return 'experimenting'
    case 'evaluate': return 'evaluating'
  }
}

/** Event-backed specialist laboratory ledger with bounded improvement loops. */
export class SpecialistLedger {
  private readonly caches = new WeakMap<Session, Map<string, SpecialistProfile>>()

  /** Read one specialist after replaying any events appended since the last read. */
  get(agent: Agent, specialistId: string): SpecialistProfile | undefined {
    const profiles = this.cache(agent.session)
    this.sync(agent.session, profiles)
    return profiles.get(specialistId)
  }

  /** Start a specialist laboratory with explicit success criteria and an iteration cap. */
  start(agent: Agent, request: StartSpecialistRequest): SpecialistProfile {
    const profiles = this.cache(agent.session)
    this.sync(agent.session, profiles)
    const profile: SpecialistProfile = {
      id: `specialist-${randomUUID()}`,
      topic: text(request.topic, 'topic'),
      objective: text(request.objective, 'objective'),
      successCriteria: list(request.successCriteria, 'successCriteria'),
      phase: nextPhase('start'),
      revision: 1,
      maxIterations: maxIterations(request.maxIterations),
      iterations: 0,
      sources: [],
      hypotheses: [],
      experiments: [],
    }
    return this.commit(agent, profiles, 'start', profile)
  }

  /** Add one traceable source and move the lab into its research phase. */
  addSource(agent: Agent, specialistId: string, request: AddSpecialistSourceRequest): SpecialistProfile {
    const current = this.require(agent, specialistId)
    const source: SpecialistSource = {
      id: `source-${randomUUID()}`,
      title: text(request.title, 'source.title'),
      locator: text(request.locator, 'source.locator'),
      addedAt: Date.now(),
    }
    return this.commit(agent, this.cache(agent.session), 'source', {
      ...current, phase: nextPhase('source'), revision: current.revision + 1, sources: [...current.sources, source],
    })
  }

  /** Add one falsifiable hypothesis and move the lab into hypothesis work. */
  addHypothesis(agent: Agent, specialistId: string, hypothesis: string): SpecialistProfile {
    const current = this.require(agent, specialistId)
    return this.commit(agent, this.cache(agent.session), 'hypothesis', {
      ...current, phase: nextPhase('hypothesis'), revision: current.revision + 1,
      hypotheses: [...current.hypotheses, text(hypothesis, 'hypothesis')],
    })
  }

  /** Add one reproducible experiment and move the lab into experiment work. */
  addExperiment(agent: Agent, specialistId: string, request: AddSpecialistExperimentRequest): SpecialistProfile {
    const current = this.require(agent, specialistId)
    const experiment: SpecialistExperiment = {
      id: `experiment-${randomUUID()}`,
      name: text(request.name, 'experiment.name'),
      dataset: text(request.dataset, 'experiment.dataset'),
      status: 'planned',
    }
    return this.commit(agent, this.cache(agent.session), 'experiment', {
      ...current, phase: nextPhase('experiment'), revision: current.revision + 1,
      experiments: [...current.experiments, experiment],
    })
  }

  /** Record a judge result; failed reviews create an improving checkpoint and never claim readiness. */
  evaluate(agent: Agent, specialistId: string, request: EvaluateSpecialistRequest): SpecialistProfile {
    const current = this.require(agent, specialistId)
    if (!Number.isFinite(request.score) || request.score < 0 || request.score > 1) throw new TypeError('score must be between 0 and 1')
    const passed = request.passed === true
    const verdict: SpecialistJudge['verdict'] = passed
      ? 'pass'
      : request.blocked === true || current.iterations + 1 >= current.maxIterations
        ? 'blocked'
        : 'needs_changes'
    const judge: SpecialistJudge = {
      verdict,
      score: request.score,
      summary: text(request.summary, 'summary'),
      requiredChanges: (request.requiredChanges ?? []).map((value, index) => text(value, `requiredChanges[${index}]`)),
      reviewedAt: Date.now(),
    }
    const experiments = current.experiments.map(experiment => ({
      ...experiment,
      status: passed ? 'passed' : 'failed',
      result: judge.summary,
    } satisfies SpecialistExperiment))
    return this.commit(agent, this.cache(agent.session), 'evaluate', {
      ...current,
      phase: verdict === 'pass' ? 'ready' : verdict === 'blocked' ? 'blocked' : 'improving',
      revision: current.revision + 1,
      iterations: current.iterations + 1,
      experiments,
      judge,
    })
  }

  private cache(session: Session): Map<string, SpecialistProfile> {
    let profiles = this.caches.get(session)
    if (profiles !== undefined) return profiles
    profiles = new Map(foldSpecialists(session.events))
    this.caches.set(session, profiles)
    return profiles
  }

  private sync(session: Session, profiles: Map<string, SpecialistProfile>): void {
    const latest = foldSpecialists(session.events)
    for (const [id, profile] of latest) profiles.set(id, profile)
  }

  private require(agent: Agent, specialistId: string): SpecialistProfile {
    const profile = this.get(agent, specialistId)
    if (profile === undefined) throw new Error(`specialist not found: ${specialistId}`)
    return profile
  }

  private commit(agent: Agent, profiles: Map<string, SpecialistProfile>, operation: SpecialistChange['operation'], specialist: SpecialistProfile): SpecialistProfile {
    const change: SpecialistChange = { kind: 'specialist/change', version: 1, operation, specialist }
    agent.session.append('specialist/change', change)
    profiles.set(specialist.id, specialist)
    return specialist
  }
}
