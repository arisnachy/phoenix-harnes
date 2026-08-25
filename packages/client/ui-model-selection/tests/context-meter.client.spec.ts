import { describe, expect, it } from 'vitest'
import { isOpenAiContextProvider, remainingContextPercent } from '../src/client/context-meter.ts'

describe('OpenAI context meter contract', () => {
  it.each(['openai', 'openai-codex'])('recognizes the exact %s provider route', (provider) => {
    expect(isOpenAiContextProvider(provider)).toBe(true)
  })

  it.each(['openrouter', 'azure-openai', 'deepseek-official', '', undefined])(
    'does not guess OpenAI identity from %s',
    (provider) => {
      expect(isOpenAiContextProvider(provider)).toBe(false)
    },
  )

  it('reports the remaining percentage from projected next-request pressure', () => {
    expect(remainingContextPercent({ projectedTokens: 25_000, contextWindow: 100_000 })).toBe(75)
  })

  it('clamps the display at the valid percentage boundaries', () => {
    expect(remainingContextPercent({ projectedTokens: 0, contextWindow: 100_000 })).toBe(100)
    expect(remainingContextPercent({ projectedTokens: 120_000, contextWindow: 100_000 })).toBe(0)
  })

  it('refuses to invent a percentage until both pressure and capacity are known', () => {
    expect(remainingContextPercent({ contextWindow: 100_000 })).toBeUndefined()
    expect(remainingContextPercent({ projectedTokens: 1_000 })).toBeUndefined()
    expect(remainingContextPercent({ projectedTokens: 1_000, contextWindow: 0 })).toBeUndefined()
    expect(remainingContextPercent(undefined)).toBeUndefined()
  })
})
