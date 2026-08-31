import { describe, expect, it } from 'vitest'
import {
  MissionPersistenceKernel,
  replayMissionKernel,
  type MissionGoalLock,
  type MissionKernelEvent,
  type MissionRoute,
} from '../src/mission-kernel.ts'

const routes: readonly MissionRoute[] = [
  { id: 'verify', strategy: 'verification-first', rationale: 'recheck', priority: 1 },
  { id: 'alternate', strategy: 'alternate-tool', rationale: 'change capability', priority: 2 },
]

const goal: MissionGoalLock = {
  objective: 'Deliver a verified weather result',
  deliverables: [{ id: 'forecast', description: 'Rendered weather forecast' }],
  acceptanceCriteria: [
    { id: 'artifact', description: 'The requested artifact exists', mandatory: true },
    { id: 'presentation', description: 'The artifact is renderable', mandatory: true },
  ],
  qualityRequirements: ['Evidence is reproducible', 'The result is complete'],
}

function kernel(events: MissionKernelEvent[] = []): MissionPersistenceKernel {
  return new MissionPersistenceKernel({
    missionId: 'mission-1',
    revision: 1,
    goal,
    writer: { record: event => events.push(event) },
  }, events)
}

describe('MissionPersistenceKernel', () => {
  it('keeps mission ACTIVE after a failed disposable attempt', () => {
    const events: MissionKernelEvent[] = []
    const value = kernel(events)
    value.start()
    value.fail({ scope: 'attempt', strategy: 'baseline', cause: 'tool failed', rootCause: 'bad input', fingerprint: 'bad-input', routes })

    expect(value.snapshot()).toMatchObject({ status: 'RECOVERING', failures: 1, attempts: 1, lastRootCause: 'bad input' })
    expect(events.find(event => event.kind === 'failure')).toMatchObject({ scope: 'attempt', status: 'RECOVERING' })
  })

  it('opens WALL_PROTOCOL and remains BLOCKED for an unavailable dependency', () => {
    const events: MissionKernelEvent[] = []
    const value = kernel(events)
    value.start()
    value.dependencyMissing('atlas:python', 'provider is not installed')

    expect(value.snapshot()).toMatchObject({ status: 'WAITING_EXTERNAL', missingDependency: 'atlas:python' })
    expect(events.filter(event => event.kind === 'wall-opened')).toHaveLength(1)
  })

  it('requires a different strategy after repeating the same route failure', () => {
    const value = kernel()
    value.start()
    value.propose(routes)
    value.select('verify')
    value.fail({ scope: 'strategy', strategy: 'verification-first', cause: 'same', rootCause: 'same', fingerprint: 'same', routes })
    expect(() => value.select('verify')).toThrow('different strategy')
    expect(value.select('alternate').selectedRoute).toBe('alternate')
  })

  it('rejects a passing judge until every criterion and the quality gate are verified', () => {
    const value = kernel()
    value.start()
    value.judge({ verdict: 'needs_changes', summary: 'more evidence', evidence: [], requiredChanges: ['add evidence'], criteria: [], quality: { verdict: 'fail', summary: 'more evidence', evidence: [], findings: ['add evidence'] } })
    expect(value.snapshot().status).toBe('ACTIVE')
    value.judge({ verdict: 'pass', summary: 'verified', evidence: ['artifact:1', 'render:1'], requiredChanges: [], criteria: [
      { id: 'artifact', verdict: 'pass', evidence: ['artifact:1'], findings: [] },
      { id: 'presentation', verdict: 'pass', evidence: ['render:1'], findings: [] },
    ], quality: { verdict: 'pass', summary: 'high quality', evidence: ['quality:1'], findings: [] } })
    expect(value.snapshot()).toMatchObject({ status: 'ACTIVE', judge: { verdict: 'needs_changes' } })
    value.markCriterion('artifact', 'IMPLEMENTED', ['artifact:1'])
    value.markCriterion('artifact', 'TESTED', ['test:1'])
    value.markCriterion('artifact', 'VERIFIED', ['artifact:1', 'test:1'])
    value.markCriterion('presentation', 'IMPLEMENTED', ['render:1'])
    value.markCriterion('presentation', 'TESTED', ['render-test:1'])
    value.markCriterion('presentation', 'VERIFIED', ['render:1', 'render-test:1'])
    value.judge({
      verdict: 'pass', summary: 'verified', evidence: ['artifact:1', 'render:1'], requiredChanges: [],
      criteria: [
        { id: 'artifact', verdict: 'pass', evidence: ['artifact:1'], findings: [] },
        { id: 'presentation', verdict: 'pass', evidence: ['render:1'], findings: [] },
      ],
      quality: { verdict: 'pass', summary: 'high quality', evidence: ['quality:1'], findings: [] },
    })
    expect(value.snapshot().status).toBe('DONE')
    expect(() => value.cancel()).toThrow('completed mission')
  })

  it('forces ordered evidence transitions and records reusable failure learning', () => {
    const events: MissionKernelEvent[] = []
    const value = kernel(events)
    value.start()
    expect(() => value.markCriterion('artifact', 'TESTED', ['test:1'])).toThrow('criterion')
    value.markCriterion('artifact', 'IMPLEMENTED', ['artifact:1'])
    expect(() => value.markCriterion('artifact', 'VERIFIED', ['artifact:1'])).toThrow('criterion')
    value.fail({ scope: 'tool', strategy: 'baseline', cause: 'timeout', rootCause: 'provider timeout', fingerprint: 'timeout', routes })
    value.recordLearning({ fingerprint: 'timeout', solution: 'use a bounded alternate provider', evidence: ['route:alternate'] })
    expect(value.snapshot().learnings).toEqual(expect.arrayContaining([
      { fingerprint: 'timeout', solution: 'use a bounded alternate provider', evidence: ['route:alternate'] },
    ]))
    expect(value.snapshot().learnings.some(learning => learning.fingerprint === 'timeout')).toBe(true)
    expect(events.filter(event => event.kind === 'learning-recorded').length).toBeGreaterThanOrEqual(2)
  })

  it('replays durable rows and resumes a blocked mission', () => {
    const events: MissionKernelEvent[] = []
    const value = kernel(events)
    value.start()
    value.dependencyMissing('mcp:calendar', 'authentication required')
    const replayed = replayMissionKernel(events, 'mission-1', 1)
    expect(replayed.status).toBe('WAITING_EXTERNAL')
    value.resume()
    expect(value.snapshot()).toMatchObject({ status: 'ACTIVE' })
    expect(events.at(-1)?.kind).toBe('resumed')
  })

  it('only explicit cancellation can terminate without verified delivery', () => {
    const events: MissionKernelEvent[] = []
    const value = kernel(events)
    value.start()
    value.cancel()
    expect(value.snapshot()).toMatchObject({ status: 'DONE', terminalReason: 'user_cancelled' })
    expect(events.at(-1)).toMatchObject({ kind: 'cancelled', terminalReason: 'user_cancelled' })
    expect(() => value.resume()).toThrow('not resumable')
  })

  it('resets stale candidate evidence after a judge requests repairs', () => {
    const value = kernel()
    value.start()
    value.markCriterion('artifact', 'IMPLEMENTED', ['artifact:old'])
    value.markCriterion('artifact', 'TESTED', ['test:old'])
    value.judge({
      verdict: 'needs_changes', summary: 'repair the artifact', evidence: ['artifact:old'],
      requiredChanges: ['replace the artifact'], criteria: [],
      quality: { verdict: 'fail', summary: 'not complete', evidence: [], findings: ['replace the artifact'] },
    })

    expect(value.snapshot().status).toBe('ACTIVE')
    expect(value.snapshot().criteria.find(item => item.id === 'artifact')).toMatchObject({ status: 'PENDING', evidence: [] })
  })
})
