import { describe, expect, it } from 'vitest'
import {
  dominatesStrategy,
  paretoEfficientStrategies,
  shouldInvestInOptimization,
  type StrategyObservation,
} from '../src/value-optimizer.ts'

const baseline: StrategyObservation = {
  id: 'baseline',
  qualityPassed: true,
  qualityScore: 0.99,
  totalTimeMs: 2_000,
  totalTokens: 1_000,
  toolCalls: 5,
  retries: 1,
  userInterventions: 0,
  monetaryCost: 0.08,
}

describe('quality-preserving value optimization', () => {
  it('never accepts strategies outside the quality floor', () => {
    expect(dominatesStrategy({ ...baseline, id: 'bad', qualityPassed: false }, baseline)).toBe(false)
    expect(dominatesStrategy(baseline, { ...baseline, id: 'bad-base', qualityPassed: false })).toBe(false)
    expect(paretoEfficientStrategies([baseline, { ...baseline, id: 'bad', qualityPassed: false }]).map(row => row.id)).toEqual(['baseline'])
  })

  it('rejects quality regression unless explicitly tolerated', () => {
    const candidate = {
      ...baseline,
      id: 'candidate',
      qualityScore: 0.98,
      totalTimeMs: 1_000,
      totalTokens: 500,
      toolCalls: 4,
      retries: 0,
      monetaryCost: 0.04,
    }
    expect(dominatesStrategy(candidate, baseline)).toBe(false)
    expect(dominatesStrategy(candidate, baseline, { maximumScoreRegression: 0.01 })).toBe(true)
    expect(() => dominatesStrategy(candidate, baseline, { maximumScoreRegression: -1 })).toThrow('maximumScoreRegression')
    expect(() => dominatesStrategy(candidate, baseline, { maximumScoreRegression: Number.NaN })).toThrow('maximumScoreRegression')
  })

  it('recognizes same-quality strategies that improve end-to-end resources', () => {
    const improved = {
      ...baseline,
      id: 'improved',
      totalTimeMs: 1_200,
      totalTokens: 700,
      toolCalls: 4,
      retries: 0,
      monetaryCost: 0.04,
    }
    expect(dominatesStrategy(improved, baseline)).toBe(true)
    expect(dominatesStrategy(baseline, improved)).toBe(false)
  })

  it('allows a pure quality improvement without resource regression', () => {
    const { qualityScore: _qualityScore, monetaryCost: _monetaryCost, ...noScores } = baseline
    expect(dominatesStrategy({ ...noScores, id: 'same' }, noScores)).toBe(false)
    expect(dominatesStrategy({ ...baseline, id: 'quality', qualityScore: 1 }, baseline)).toBe(true)
  })

  it('compares money only when both observations report it', () => {
    const { monetaryCost: _money, ...withoutMoney } = baseline
    const candidate = { ...withoutMoney, id: 'candidate', totalTokens: 900 }
    expect(dominatesStrategy(candidate, baseline)).toBe(true)
    expect(dominatesStrategy({ ...baseline, id: 'expensive', monetaryCost: 0.09 }, baseline)).toBe(false)
  })

  it('returns the non-dominated quality frontier as defensive copies', () => {
    const efficient = {
      ...baseline,
      id: 'efficient',
      totalTimeMs: 1_000,
      totalTokens: 500,
      toolCalls: 4,
      retries: 0,
      monetaryCost: 0.04,
    }
    const frontier = paretoEfficientStrategies([
      baseline,
      efficient,
      { ...efficient, id: 'bad', qualityPassed: false },
      { ...efficient, id: 'tradeoff', totalTimeMs: 900, totalTokens: 600 },
    ])
    expect(frontier.map(row => row.id).sort()).toEqual(['efficient', 'tradeoff'])
    ;(frontier[0] as { id: string }).id = 'mutated'
    expect(efficient.id).toBe('efficient')
  })

  it('rejects optimization whose analysis time cannot amortize over expected runs', () => {
    expect(shouldInvestInOptimization({
      expectedFutureRuns: 20,
      qualityFloorSatisfied: true,
      timeInvestmentMs: 120_000,
      timeSavingPerRunMs: 1_000,
      monetaryInvestment: 0.20,
      monetarySavingPerRun: 0.02,
    })).toEqual({
      worthIt: false,
      monetaryBreakEvenRuns: 10,
      timeBreakEvenRuns: 120,
      requiredRuns: 120,
    })
  })

  it('permits optimization only when money and time both pay back', () => {
    expect(shouldInvestInOptimization({
      expectedFutureRuns: 500,
      qualityFloorSatisfied: true,
      timeInvestmentMs: 20_000,
      timeSavingPerRunMs: 1_000,
      monetaryInvestment: 1,
      monetarySavingPerRun: 0.05,
    })).toEqual({
      worthIt: true,
      monetaryBreakEvenRuns: 20,
      timeBreakEvenRuns: 20,
      requiredRuns: 20,
    })
  })

  it('does not spend anything to optimize a path that misses the quality floor', () => {
    expect(shouldInvestInOptimization({
      expectedFutureRuns: 1_000,
      qualityFloorSatisfied: false,
      monetaryInvestment: 1,
      monetarySavingPerRun: 1,
    })).toEqual({ worthIt: false, requiredRuns: Number.POSITIVE_INFINITY })
  })

  it('handles free analysis and impossible payback explicitly', () => {
    expect(shouldInvestInOptimization({
      expectedFutureRuns: 0,
      qualityFloorSatisfied: true,
    })).toEqual({ worthIt: true, requiredRuns: 0 })

    expect(shouldInvestInOptimization({
      expectedFutureRuns: 100,
      qualityFloorSatisfied: true,
      monetaryInvestment: 1,
      monetarySavingPerRun: 0,
    })).toEqual({
      worthIt: false,
      monetaryBreakEvenRuns: Number.POSITIVE_INFINITY,
      requiredRuns: Number.POSITIVE_INFINITY,
    })

    expect(shouldInvestInOptimization({
      expectedFutureRuns: 100,
      qualityFloorSatisfied: true,
      timeInvestmentMs: 1_000,
      timeSavingPerRunMs: 0,
    })).toEqual({
      worthIt: false,
      timeBreakEvenRuns: Number.POSITIVE_INFINITY,
      requiredRuns: Number.POSITIVE_INFINITY,
    })
  })

  it('rejects invalid economic inputs instead of fabricating a decision', () => {
    expect(() => shouldInvestInOptimization({ expectedFutureRuns: -1, qualityFloorSatisfied: true })).toThrow('expectedFutureRuns')
    expect(() => shouldInvestInOptimization({ expectedFutureRuns: 1.5, qualityFloorSatisfied: true })).toThrow('expectedFutureRuns')
    expect(() => shouldInvestInOptimization({ expectedFutureRuns: 1, qualityFloorSatisfied: true, monetaryInvestment: -1 })).toThrow('monetaryInvestment')
    expect(() => shouldInvestInOptimization({ expectedFutureRuns: 1, qualityFloorSatisfied: true, monetarySavingPerRun: Number.NaN })).toThrow('monetarySavingPerRun')
    expect(() => shouldInvestInOptimization({ expectedFutureRuns: 1, qualityFloorSatisfied: true, timeInvestmentMs: -1 })).toThrow('timeInvestmentMs')
    expect(() => shouldInvestInOptimization({ expectedFutureRuns: 1, qualityFloorSatisfied: true, timeSavingPerRunMs: Number.POSITIVE_INFINITY })).toThrow('timeSavingPerRunMs')
  })
})
