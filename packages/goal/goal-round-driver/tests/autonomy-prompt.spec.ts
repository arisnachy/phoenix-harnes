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
    expect(text).toContain('Never invoke unrelated capabilities')
    expect(text).toContain('respect the stated knowledge cutoff')
    expect(text).toContain('provide the best useful output')
    expect(text).toContain('A prediction or probabilistic outcome is never guaranteed')
    expect(text).toContain('Break the requested objective into allowed preparation')
    expect(text).toContain('preparing an unsubmitted draft are separate from actually staking funds')
    expect(text).toContain('not transaction-specific authorization for staking money')
    expect(text).toContain('browser diagnose_page tool')
    expect(text).toContain('distinguish page failures from cross-origin frame failures')
    expect(text).toContain('Do not bypass website access controls')
    expect(text).toContain('Tool schemas are executable contracts')
    expect(text).toContain('MiniBrowser Secure Ask broker')
    expect(text).toContain('independent personal and Kira service identities')
    expect(text).toContain('Never interpret user silence as permission to create a new account')
    expect(text).toContain('authentication-gate message or visible INGRESAR control')
    expect(text).toContain('verify that the authentication gate disappeared')
    expect(text).toContain('A broken MCP stdio pipe (EPIPE)')
    expect(text).toContain('Verify a changed page state')
    expect(text).toContain('An ambiguous submission failure must be verified read-only')
  })
})
