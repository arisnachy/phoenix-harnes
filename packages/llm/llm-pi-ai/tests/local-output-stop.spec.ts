import { describe, expect, it } from 'vitest'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { CONTEXT_WINDOW_EXCEEDED_CODE } from '@phoenix-ai/dsh-llm'
import { mapStopReason } from '../src/stream.ts'

const earlyLength = {
  role: 'assistant',
  provider: 'phoenix-local',
  model: 'phoenix-local',
  api: 'openai-completions',
  stopReason: 'length',
  content: [{ type: 'text', text: 'Hola' }],
  usage: { input: 43, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 44 },
} as unknown as AssistantMessage

describe('Phoenix Local short output completion', () => {
  it('does not infer context overflow solely from an early length stop', () => {
    expect(mapStopReason(earlyLength, 4096, 256, true)).toEqual({ kind: 'max-tokens' })
  })

  it('retains compact-and-retry semantics for hosted models', () => {
    expect(mapStopReason(earlyLength, 4096, 256, false)).toMatchObject({
      kind: 'error',
      failure: { code: CONTEXT_WINDOW_EXCEEDED_CODE },
    })
  })
})
