import { describe, expect, it } from 'vitest'
import { ModelCapabilityLadder } from '../src/model-ladder.ts'

const A = { provider: 'p1', model: 'architect' }
const B = { provider: 'p2', model: 'coder' }

function evidence(
  ladder: ModelCapabilityLadder,
  ref: typeof A,
  dimension: Parameters<typeof ladder.record>[0]['dimension'],
  score: number,
): void {
  for (let i = 0; i < 8; i++) {
    ladder.record({ ...ref, dimension, score, source: 'benchmark', reproducible: true, observedAt: Date.now() - i })
  }
}

describe('PHOENIX Model Capability Ladder', () => {
  it('does not let a strong coder command without orchestration evidence', () => {
    const ladder = new ModelCapabilityLadder()
    evidence(ladder, B, 'coding', 99)
    evidence(ladder, B, 'debugging', 96)
    evidence(ladder, B, 'reliability', 95)
    expect(ladder.rank('builder')).toHaveLength(1)
    expect(ladder.rank('orchestrator')).toHaveLength(0)
  })

  it('selects a proven orchestrator and excludes it immediately when quarantined', () => {
    const ladder = new ModelCapabilityLadder()
    for (const [dimension, score] of [
      ['orchestration', 96], ['planning', 94], ['reasoning', 91], ['toolUse', 88], ['reliability', 96], ['security', 91],
    ] as const) evidence(ladder, A, dimension, score)
    expect(ladder.rank('orchestrator')[0]).toMatchObject(A)
    ladder.quarantine(A)
    expect(ladder.rank('orchestrator')).toEqual([])
  })

  it('keeps newly discovered models provisional', () => {
    const ladder = new ModelCapabilityLadder()
    ladder.register(A)
    expect(ladder.snapshot(A)?.trust).toBe('provisional')
    expect(ladder.rank('routine')).toEqual([])
  })

  it('never grants authority from mission or collective observation alone', () => {
    const ladder = new ModelCapabilityLadder()
    for (let i = 0; i < 40; i++) {
      ladder.record({ ...A, dimension: 'reliability', score: 100, source: 'mission', reproducible: true })
      ladder.record({ ...A, dimension: 'reasoning', score: 100, source: 'collective-observation', reproducible: true })
    }
    expect(ladder.snapshot(A)?.trust).toBe('provisional')
    expect(ladder.rank('routine')).toEqual([])
  })

  it('returns to provisional after quarantine when only non-authority evidence exists', () => {
    const ladder = new ModelCapabilityLadder()
    for (let i = 0; i < 20; i++) {
      ladder.record({ ...A, dimension: 'reliability', score: 99, source: 'mission', reproducible: true })
    }
    ladder.quarantine(A)
    ladder.releaseQuarantine(A)
    expect(ladder.snapshot(A)?.trust).toBe('provisional')
  })

})
