import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import { judgeGoalCompletion, resolveGoalJudgeAgentOptions } from '../src/judge.ts'

function structuredProvider() {
  return {
    capabilities: { outputSchema: true, toolFilter: true },
  }
}

describe('goal judge routing regressions', () => {
  it('uses the active non-Codex request route even when Agent.options still carries the startup Codex route', async () => {
    const parent = {
      id: SessionId('active-route-parent'),
      options: { provider: 'openai-codex', model: 'gpt-5.6-sol' },
      session: {
        requestHeader: () => ({
          config: {
            provider: 'anthropic',
            model: 'claude-opus-4-1',
            reasoningEffort: 'high',
          },
        }),
      },
    } as never

    await expect(resolveGoalJudgeAgentOptions({
      parent,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-1',
      reasoningEffort: 'high',
    })
  })

  it('does not silently fall back to a Luna subagent provider when the configured independent backend is absent', async () => {
    const start = vi.fn(async () => ({
      result: Promise.resolve({
        output: [],
        stopReason: 'completed' as const,
        structured: { verdict: 'pass', summary: 'unexpected fallback', findings: [], required_changes: [] },
      }),
      dispose: async () => {},
    }))

    const result = await judgeGoalCompletion({
      subagents: {
        getProvider: name => name === 'luna' ? structuredProvider() as never : undefined,
        list: () => ['luna'],
        start: start as never,
      },
      provider: 'spawn',
      parent: {
        id: SessionId('no-fallback-parent'),
        options: { provider: 'anthropic', model: 'claude-opus-4-1' },
        session: { requestHeader: () => undefined },
      } as never,
      objective: 'Verify the current objective',
      round: 2,
      signal: new AbortController().signal,
    })

    expect(result).toBeUndefined()
    expect(start).not.toHaveBeenCalled()
  })

  it('treats an unavailable judge runtime as a transient execution failure, not a blocked verdict', async () => {
    const result = await judgeGoalCompletion({
      subagents: undefined,
      provider: 'spawn',
      parent: {
        id: SessionId('missing-runtime-parent'),
        options: { provider: 'openrouter', model: 'qwen/qwen3-coder' },
        session: { requestHeader: () => undefined },
      } as never,
      objective: 'Verify the current objective',
      round: 3,
      signal: new AbortController().signal,
    })

    expect(result).toBeUndefined()
  })
})
