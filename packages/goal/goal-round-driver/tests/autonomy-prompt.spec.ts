import { describe, expect, it } from 'vitest'
import { GoalId, type GoalView } from '@phoenix-ai/dsh-goal'
import { renderGoalRoundPrompt } from '../src/prompt.ts'

function goal(roundsStarted = 0): GoalView {
  return {
    id: GoalId('autonomy-prompt'),
    revision: 1,
    objective: 'finish the requested change completely',
    phase: 'active',
    maxGoalRounds: 3,
    roundsStarted,
    createdAt: 1,
    updatedAt: 1,
    activation: 'armed',
  }
}

describe('goal-round autonomous continuation guidance', () => {
  it('does not pause an authorized mission for process ceremony or internal attempt limits', () => {
    const block = renderGoalRoundPrompt(goal(), 1)[0]
    if (block?.type !== 'text') throw new Error('expected text goal-round prompt')
    const text = block.text

    expect(text).toContain('Do not pause for process-skill ceremony')
    expect(text).toContain('brainstorming or implementation-plan approval')
    expect(text).toContain('Internal retry, attempt, or execution-window limits never complete the mission')
    expect(text).toContain('Only a genuine external dependency')
    expect(text).toContain('permission, credential, safety policy, exhausted provider quota')
    expect(text).toContain('repair it, acquire or build a missing capability, or use another route')
  })

  it('infers applicable edge cases without waiting for the user to enumerate them', () => {
    const block = renderGoalRoundPrompt(goal(), 1)[0]
    if (block?.type !== 'text') throw new Error('expected text goal-round prompt')
    const text = block.text

    expect(text).toContain('infer the relevant unstated edge cases and failure modes')
    expect(text).toContain('Do not wait for the user to enumerate them')
    expect(text).toContain('empty, missing, malformed, boundary, duplicate, stale, partial-failure, retry/timeout, permission, concurrency, restart/recovery, and compatibility')
    expect(text).toContain('only when they are applicable to this objective')
    expect(text).toContain('Treat applicable inferred cases as mandatory quality criteria')
    expect(text).toContain('add executable or otherwise reproducible verification for them')
    expect(text).toContain('explicit requirements and the applicable inferred edge cases')
  })
})
