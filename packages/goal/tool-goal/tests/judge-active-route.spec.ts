import { describe, expect, it } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import { resolveGoalJudgeAgentOptions } from '../src/judge-route.ts'

describe('completion verifier active-model routing', () => {
  it('uses the active non-Codex request route even when startup Agent.options still says Codex', async () => {
    const parent = {
      id: SessionId('active-non-codex-route'),
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

  it('reserves Luna only for an actively selected openai-codex route', async () => {
    const parent = {
      id: SessionId('active-codex-route'),
      options: { provider: 'anthropic', model: 'claude-opus-4-1' },
      session: {
        requestHeader: () => ({
          config: {
            provider: 'openai-codex',
            model: 'gpt-5.6-sol',
          },
        }),
      },
    } as never

    await expect(resolveGoalJudgeAgentOptions({
      parent,
      signal: new AbortController().signal,
    })).resolves.toMatchObject({
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
    })
  })
})
