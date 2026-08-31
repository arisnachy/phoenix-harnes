import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import { judgeGoalCompletion, recordGoalJudge } from '../src/judge.ts'

const parent = { id: SessionId('judge-parent') } as never

function provider() {
  return {
    capabilities: { outputSchema: true, toolFilter: true },
  }
}

describe('goal completion judge', () => {
  it('runs a fresh structured read-only review and returns pass', async () => {
    const start = vi.fn(async (_name: string, request: Record<string, unknown>) => ({
      result: Promise.resolve({
        output: [],
        stopReason: 'completed' as const,
        structured: {
          verdict: 'pass',
          summary: 'All acceptance evidence is present.',
          findings: [],
          required_changes: [],
        },
      }),
      dispose: vi.fn(async () => {}),
      request,
    }))
    const result = await judgeGoalCompletion({
      subagents: { getProvider: () => provider() as never, start: start as never },
      provider: 'spawn',
      parent,
      objective: 'Finish the feature',
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result).toEqual({
      verdict: 'pass',
      summary: 'All acceptance evidence is present.',
      findings: [],
      requiredChanges: [],
    })
    expect(start).toHaveBeenCalledWith('spawn', expect.objectContaining({
      label: 'goal-completion-judge',
      toolFilter: { allow: ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch'] },
      outputSchema: expect.objectContaining({ required: ['verdict', 'summary', 'findings', 'required_changes'] }) as unknown,
    }))
  })

  it('keeps the goal open when the judge requires changes', async () => {
    const result = await judgeGoalCompletion({
      subagents: {
        getProvider: () => provider() as never,
        start: vi.fn(async () => ({
          result: Promise.resolve({
            output: [],
            stopReason: 'completed' as const,
            structured: {
              verdict: 'needs_changes',
              summary: 'The acceptance test is missing.',
              findings: ['No assembled test proves the user-visible path.'],
              required_changes: ['Add and run the assembled acceptance test.'],
            },
          }),
          dispose: async () => {},
        })) as never,
      },
      provider: 'spawn',
      parent,
      objective: 'Finish the feature',
      round: 1,
      signal: new AbortController().signal,
    })
    expect(result.verdict).toBe('needs_changes')
    expect(result.requiredChanges).toEqual(['Add and run the assembled acceptance test.'])
  })

  it('falls back to an available structured provider when the configured alias is absent', async () => {
    const start = vi.fn(async (name: string) => ({
      result: Promise.resolve({
        output: [],
        stopReason: 'completed' as const,
        structured: {
          verdict: 'pass',
          summary: 'The objective is verified.',
          findings: [],
          required_changes: [],
        },
      }),
      dispose: vi.fn(async () => {}),
      name,
    }))
    const result = await judgeGoalCompletion({
      subagents: {
        getProvider: name => name === 'luna' ? provider() as never : undefined,
        list: () => ['luna'],
        start: start as never,
      },
      provider: 'spawn',
      parent,
      objective: 'Finish the feature',
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result.verdict).toBe('pass')
    expect(start).toHaveBeenCalledWith('luna', expect.anything())
  })

  it('keeps verification pending without exposing provider details when no judge service is mounted', async () => {
    const result = await judgeGoalCompletion({
      subagents: undefined,
      provider: 'spawn',
      parent,
      objective: 'Finish the feature',
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result).toMatchObject({
      verdict: 'blocked',
      summary: 'Independent verification is not ready yet; the mission remains active and will continue automatically.',
    })
  })

  it('fails closed for an unavailable judge and persists a bounded audit row', () => {
    const session = Session.create(SessionId('goal-judge-session'))
    recordGoalJudge(session, {
      callId: 'call-1' as never,
      goalId: 'goal-1',
      revision: 1,
      round: 3,
      verdict: 'blocked',
      summary: 'goal judge provider is unavailable',
      findings: [],
      requiredChanges: [],
    })
    expect(session.events).toHaveLength(1)
    expect(session.events[0]).toMatchObject({ type: 'goal/judge', data: { verdict: 'blocked', round: 3 } })
  })
})
