import { describe, expect, it } from 'vitest'
import { ExperienceLearningEngine } from '../src/experience.ts'
import { isHumanTaskMessage, learningOwnerSessionId } from '../src/team-learning-context.ts'

describe('team learning attribution', () => {
  const lead = { id: 'root', header: { origin: 'user' } }
  const child = { id: 'agent-1', header: { origin: 'subagent', parentSession: 'root' } }
  const fork = { id: 'fork', header: { origin: 'fork', parentSession: 'root' } }
  const human = { source: { kind: 'user' } }
  const teamAssignment = { source: { kind: 'team-message' } }

  it('attributes only a real direct child to its parent task', () => {
    expect(learningOwnerSessionId(lead)).toBe('root')
    expect(learningOwnerSessionId(child)).toBe('root')
    expect(learningOwnerSessionId(fork)).toBe('fork')
    expect(learningOwnerSessionId({ id: 'orphan', header: { origin: 'subagent' } })).toBe('orphan')
  })

  it('never learns a fabricated user preference from a teammate assignment', () => {
    expect(isHumanTaskMessage(lead, human)).toBe(true)
    expect(isHumanTaskMessage(fork, human)).toBe(true)
    expect(isHumanTaskMessage(child, human)).toBe(false)
    expect(isHumanTaskMessage(lead, teamAssignment)).toBe(false)
    expect(isHumanTaskMessage(child, teamAssignment)).toBe(false)
  })

  it('measures delegated tokens, calls and failures in the verified parent episode', () => {
    const experience = new ExperienceLearningEngine()
    experience.beginTask({ sessionId: 'root', text: 'Arregla la autenticación OAuth de Phoenix',
      occurredAt: 1000, projectId: 'phoenix' })
    experience.observeUsage(learningOwnerSessionId(lead), { inputTokens: 80, outputTokens: 20 })
    experience.observeUsage(learningOwnerSessionId(child), { inputTokens: 130, outputTokens: 30 })
    experience.observeToolCall(learningOwnerSessionId(child))
    experience.observeToolResult(learningOwnerSessionId(child), true)
    experience.observeRetry(learningOwnerSessionId(child))
    const result = experience.completeVerified('root', 3000)
    expect(result).toMatchObject({
      totalTokens: 260, totalToolCalls: 1, totalFailedToolCalls: 1,
      totalRetries: 1, verifiedSuccesses: 1, projectId: 'phoenix',
    })
  })
})
