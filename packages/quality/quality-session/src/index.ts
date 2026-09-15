/** Session-backed durable provider for PHOENIX quality assessments. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import {
  QualityAssessmentId,
  QualityService,
  type QualityAssessmentRef,
  type QualityAssessmentSnapshot,
  type QualityCriterion,
  type QualityInnovation,
  type QualityMutation,
  type QualityScenario,
  type QualityTaskClass,
  type RiskForecast,
  type StartQualityAssessmentRequest,
} from '@phoenix-ai/dsh-quality'
import { foldQuality } from './fold.ts'

export const name = 'quality-session'

const TASK_CLASSES: readonly QualityTaskClass[] = ['conversational', 'bounded', 'substantial', 'living']

function clone<T>(value: T): T {
  return structuredClone(value)
}

function normalizedText(label: string, value: string, allowEmpty = false): string {
  if ((!allowEmpty && value.length === 0) || value !== value.trim()) {
    throw new TypeError(`${label} must be ${allowEmpty ? 'normalized' : 'a non-empty normalized'} string`)
  }
  return value
}

function normalizedList(label: string, values: readonly string[]): string[] {
  return values.map(value => normalizedText(label, value))
}

function criterion(value: QualityCriterion): QualityCriterion {
  normalizedText('criterion id', value.id)
  normalizedText('criterion text', value.text)
  return { ...clone(value), evidence: normalizedList('criterion evidence', value.evidence) }
}

function scenario(value: QualityScenario): QualityScenario {
  normalizedText('scenario id', value.id)
  normalizedText('scenario title', value.title)
  if (value.blocker !== undefined) normalizedText('scenario blocker', value.blocker)
  return { ...clone(value), evidence: normalizedList('scenario evidence', value.evidence) }
}

function forecast(value: RiskForecast): RiskForecast {
  normalizedText('forecast id', value.id)
  normalizedText('forecast scenario', value.scenario)
  normalizedText('forecast mitigation', value.mitigation, true)
  return { ...clone(value), evidence: normalizedList('forecast evidence', value.evidence) }
}

function innovation(value: QualityInnovation): QualityInnovation {
  normalizedText('innovation rationale', value.rationale)
  return { ...clone(value), evidence: normalizedList('innovation evidence', value.evidence) }
}

function replaceById<T extends { readonly id: string }>(values: readonly T[], value: T): T[] {
  const index = values.findIndex(item => item.id === value.id)
  if (index < 0) return [...values.map(clone), clone(value)]
  return values.map((item, candidate) => candidate === index ? clone(value) : clone(item))
}

function assertRef(current: QualityAssessmentSnapshot, ref: QualityAssessmentRef): void {
  if (current.id !== ref.id || current.revision !== ref.revision) {
    throw new Error(`stale quality assessment ref: expected ${current.id}@${current.revision}`)
  }
}

function nextSnapshot(current: QualityAssessmentSnapshot, mutation: QualityMutation): QualityAssessmentSnapshot {
  let patch: Partial<QualityAssessmentSnapshot>
  switch (mutation.kind) {
    case 'criterion':
      patch = { criteria: replaceById(current.criteria, criterion(mutation.value)) }
      break
    case 'scenario':
      patch = { scenarios: replaceById(current.scenarios, scenario(mutation.value)) }
      break
    case 'forecast':
      patch = { forecasts: replaceById(current.forecasts, forecast(mutation.value)) }
      break
    case 'required-changes':
      patch = { requiredChanges: normalizedList('required change', mutation.value) }
      break
    case 'innovation':
      patch = { innovation: innovation(mutation.value) }
      break
  }
  return {
    ...clone(current),
    ...patch,
    revision: current.revision + 1,
    updatedAt: Math.max(Date.now(), current.updatedAt),
  }
}

/** Durable provider whose canonical state is reconstructed from the owning Session event log. */
export class SessionQualityService extends QualityService {
  constructor(ctx: Context) {
    super(ctx)
  }

  get(agent: Agent): QualityAssessmentSnapshot | undefined {
    const current = foldQuality(agent.session.events)
    return current === undefined ? undefined : clone(current)
  }

  start(agent: Agent, request: StartQualityAssessmentRequest): QualityAssessmentSnapshot {
    const objective = request.objective.trim()
    normalizedText('quality objective', objective)
    if (!TASK_CLASSES.includes(request.taskClass)) throw new TypeError(`unknown quality task class ${JSON.stringify(request.taskClass)}`)
    const now = Date.now()
    const assessment: QualityAssessmentSnapshot = {
      id: QualityAssessmentId(`quality-${randomUUID()}`),
      revision: 1,
      objective,
      taskClass: request.taskClass,
      criteria: (request.criteria ?? []).map(criterion),
      scenarios: [],
      forecasts: [],
      requiredChanges: [],
      createdAt: now,
      updatedAt: now,
    }
    agent.session.append('quality/change', {
      kind: 'quality/change',
      version: 1,
      operation: 'start',
      assessment: clone(assessment),
    })
    return clone(assessment)
  }

  record(agent: Agent, ref: QualityAssessmentRef, mutation: QualityMutation): QualityAssessmentSnapshot {
    const current = this.get(agent)
    if (current === undefined) throw new Error('stale quality assessment ref: no current assessment')
    assertRef(current, ref)
    const assessment = nextSnapshot(current, mutation)
    agent.session.append('quality/change', {
      kind: 'quality/change',
      version: 1,
      operation: 'record',
      assessment: clone(assessment),
    })
    return clone(assessment)
  }
}

export default SessionQualityService
