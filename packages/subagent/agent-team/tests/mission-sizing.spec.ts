import { describe, expect, it } from 'vitest'
import { teammateBudgetForMission } from '../src/mission-sizing.ts'

describe('adaptive mission specialist budget', () => {
  it('uses one specialist for simple, two for medium and three for difficult missions', () => {
    expect(teammateBudgetForMission('simple')).toBe(1)
    expect(teammateBudgetForMission('medium')).toBe(2)
    expect(teammateBudgetForMission('difficult')).toBe(3)
  })

  it('caps exceptional missions at three specialists', () => {
    expect(teammateBudgetForMission('exceptional')).toBe(3)
  })
})
