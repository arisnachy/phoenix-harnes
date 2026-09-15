import { describe, expect, it } from 'vitest'
import { GoalId, type GoalView } from '@phoenix-ai/dsh-goal'
import { renderGoalRoundPrompt } from '../src/prompt.ts'

function goal(): GoalView {
  return {
    id: GoalId('human-output-contract'),
    revision: 1,
    objective: 'finish the requested change completely',
    phase: 'active',
    maxGoalRounds: 3,
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 1,
    activation: 'armed',
  }
}

describe('goal-round human output contract', () => {
  it('keeps execution scaffolding private while preserving full mission quality', () => {
    const block = renderGoalRoundPrompt(goal(), 1)[0]
    if (block === undefined || !('text' in block) || typeof block.text !== 'string') {
      throw new Error('expected text goal-round prompt')
    }
    const text = block.text

    expect(text).toContain('Keep execution scaffolding private')
    expect(text).toContain('Do not narrate workflow names, selected strategy, round counters, gates, retries, or internal state')
    expect(text).toContain('Speak to the user naturally, warmly, and directly')
    expect(text).toContain('Fast or lightweight execution changes only internal routing and latency')
    expect(text).toContain('never reduce requested scope, deliverables, verification, or quality')
    expect(text).toContain('Do not announce completion until the exact requested outcome is delivered and verified')
  })
})
