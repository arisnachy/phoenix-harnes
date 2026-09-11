import { describe, expect, it } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import { resolveGoalJudgeAgentOptions } from '../src/judge-route.ts'

describe('Codex completion judge routing', () => {
  it('returns review to the exact Codex model selected by the user', async () => {
    await expect(resolveGoalJudgeAgentOptions({
      parent: {
        id: SessionId('codex-selected-reviewer'),
        options: {
          provider: 'openai-codex',
          model: 'gpt-5.6-sol',
          reasoningEffort: ReasoningEffortId('high'),
        },
      } as never,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.6-sol',
      reasoningEffort: ReasoningEffortId('high'),
    })
  })

  it('does not introduce Codex routing for API-key or external providers', async () => {
    await expect(resolveGoalJudgeAgentOptions({
      parent: {
        id: SessionId('external-selected-reviewer'),
        options: {
          provider: 'anthropic',
          model: 'claude-opus',
          reasoningEffort: ReasoningEffortId('high'),
        },
      } as never,
      signal: new AbortController().signal,
    })).resolves.toEqual({
      provider: 'anthropic',
      model: 'claude-opus',
      reasoningEffort: ReasoningEffortId('high'),
    })
  })
})
