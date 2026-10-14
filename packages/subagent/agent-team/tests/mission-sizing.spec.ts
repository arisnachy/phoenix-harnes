import { describe, expect, it } from 'vitest'
import { teammateBudgetForMission } from '../src/mission-sizing.ts'

describe('adaptive mission specialist budget', () => {
  it('uses one specialist for simple, two for medium and three for difficult missions', () => {
    expect(teammateBudgetForMission('simple')).toBe(1)
    expect(teammateBudgetForMission('medium')).toBe(2)
    expect(teammateBudgetForMission('difficult')).toBe(3)
  })

  it('allows a maximum of five only for exceptional missions', () => {
    expect(teammateBudgetForMission('exceptional')).toBe(5)
  })
})
