import { describe, expect, it } from 'vitest'
import { assessHabitExperience, formatHabitGuidance } from '../src/habit.ts'
import type { ExperienceAggregate, ExperienceRunMetrics, ExperienceMaturity } from '../src/experience.ts'
import { fingerprintTask } from '../src/task-context.ts'

function run(overrides: Partial<ExperienceRunMetrics> = {}): ExperienceRunMetrics {
  return {
    occurredAt: 1,
    wallTimeMs: 1_000,
    totalTokens: 100,
    toolCalls: 4,
    failedToolCalls: 0,
    retries: 0,
    userInterventions: 0,
    verified: true,
    qualityPassed: true,
    ...overrides,
  }
}

function aggregate(
  maturity: ExperienceMaturity,
  overrides: Partial<ExperienceAggregate> = {},
): ExperienceAggregate {
  const recentRuns = overrides.recentRuns ?? [run(), run(), run(), run()]
  const runs = overrides.runs ?? recentRuns.length
  return {
    version: 1,
    key: 'habit-key',
    taskFingerprint: fingerprintTask('fill monthly clinic survey'),
    taskSummary: 'Fill monthly clinic survey',
    maturity,
    runs,
    verifiedSuccesses: overrides.verifiedSuccesses ?? runs,
    failures: overrides.failures ?? 0,
    totalWallTimeMs: overrides.totalWallTimeMs ?? recentRuns.reduce((sum, item) => sum + item.wallTimeMs, 0),
    totalTokens: overrides.totalTokens ?? recentRuns.reduce((sum, item) => sum + item.totalTokens, 0),
    totalToolCalls: overrides.totalToolCalls ?? recentRuns.reduce((sum, item) => sum + item.toolCalls, 0),
    totalFailedToolCalls: overrides.totalFailedToolCalls ?? recentRuns.reduce((sum, item) => sum + item.failedToolCalls, 0),
    totalRetries: overrides.totalRetries ?? recentRuns.reduce((sum, item) => sum + item.retries, 0),
    totalUserInterventions: overrides.totalUserInterventions ?? recentRuns.reduce((sum, item) => sum + item.userInterventions, 0),
    firstObservedAt: 1,
    lastObservedAt: 10,
    recentRuns,
    ...overrides,
  }
}

describe('habit learning policy', () => {
  it('stays silent while evidence is immature', () => {
    for (const maturity of ['novel', 'repeated', 'candidate'] as const) {
      const assessment = assessHabitExperience(aggregate(maturity))
      expect(assessment.mode).toBe('observe')
      expect(assessment.driftDetected).toBe(false)
      expect(assessment.optimizationCandidate).toBe(false)
      expect(formatHabitGuidance(assessment)).toBe('')
    }
  })

  it('reuses validated experience without paying for rediscovery', () => {
    const assessment = assessHabitExperience(aggregate('validated'))
    expect(assessment).toMatchObject({
      mode: 'reuse',
      verifiedRuns: 4,
      driftDetected: false,
      optimizationCandidate: false,
      averageWallTimeMs: 1_000,
      averageTokens: 100,
      averageToolCalls: 4,
      averageFriction: 0,
    })
    expect(assessment.confidence).toBeCloseTo(0.93)
    expect(formatHabitGuidance(assessment)).toContain('REUSE')
    expect(formatHabitGuidance(assessment)).toContain('Do not add optimization analysis')
  })

  it('flags habitual friction as an optimization candidate without auto-optimizing', () => {
    const noisy = [run({ retries: 1 }), run(), run({ failedToolCalls: 1 }), run()]
    const assessment = assessHabitExperience(aggregate('habitual', {
      recentRuns: noisy,
      totalRetries: 1,
      totalFailedToolCalls: 1,
    }))
    expect(assessment.mode).toBe('reuse')
    expect(assessment.optimizationCandidate).toBe(true)
    expect(formatHabitGuidance(assessment)).toContain('total lifecycle value')
  })

  it('drops back to deliberate review when latency drifts', () => {
    const assessment = assessHabitExperience(aggregate('habitual', {
      recentRuns: [
        run({ wallTimeMs: 1_000 }),
        run({ wallTimeMs: 1_000 }),
        run({ wallTimeMs: 1_600 }),
        run({ wallTimeMs: 1_600 }),
      ],
      totalWallTimeMs: 5_200,
    }))
    expect(assessment.mode).toBe('review')
    expect(assessment.driftDetected).toBe(true)
    expect(assessment.optimizationCandidate).toBe(false)
    expect(formatHabitGuidance(assessment)).toContain('REVIEW')
    expect(formatHabitGuidance(assessment)).toContain('Do not blindly replay')
  })

  it('detects friction drift even when latency is stable', () => {
    const assessment = assessHabitExperience(aggregate('validated', {
      recentRuns: [
        run(),
        run(),
        run({ retries: 1 }),
        run({ failedToolCalls: 1 }),
      ],
      totalRetries: 1,
      totalFailedToolCalls: 1,
    }))
    expect(assessment.mode).toBe('review')
  })

  it('requires four recent runs before declaring drift', () => {
    const assessment = assessHabitExperience(aggregate('validated', {
      recentRuns: [run({ wallTimeMs: 100 }), run({ wallTimeMs: 10_000 }), run({ retries: 5 })],
      runs: 3,
      totalWallTimeMs: 11_100,
      totalRetries: 5,
    }))
    expect(assessment.mode).toBe('reuse')
    expect(assessment.driftDetected).toBe(false)
  })

  it('handles zero-run imported diagnostics and clamps confidence to observed success', () => {
    const assessment = assessHabitExperience(aggregate('habitual', {
      runs: 0,
      verifiedSuccesses: 1,
      failures: 3,
      totalWallTimeMs: 0,
      totalTokens: 0,
      totalToolCalls: 0,
      totalFailedToolCalls: 0,
      totalRetries: 0,
      totalUserInterventions: 0,
      recentRuns: [],
    }))
    expect(assessment.averageWallTimeMs).toBe(0)
    expect(assessment.confidence).toBeCloseTo(0.245)
  })

  it('covers the zero-baseline drift guard', () => {
    const assessment = assessHabitExperience(aggregate('habitual', {
      recentRuns: [
        run({ wallTimeMs: 0 }),
        run({ wallTimeMs: 0 }),
        run({ wallTimeMs: 1_000 }),
        run({ wallTimeMs: 1_000 }),
      ],
      totalWallTimeMs: 2_000,
    }))
    expect(assessment.mode).toBe('reuse')
  })
})
