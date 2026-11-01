import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createHighlighterSpy } = vi.hoisted(() => ({
  createHighlighterSpy: vi.fn(),
}))

vi.mock('shiki/core', async () => {
  const actual = await vi.importActual<typeof import('shiki/core')>('shiki/core')
  return {
    ...actual,
    createHighlighterCoreSync: vi.fn((...args: Parameters<typeof actual.createHighlighterCoreSync>) => {
      createHighlighterSpy()
      return actual.createHighlighterCoreSync(...args)
    }),
  }
})

describe('highlight cold start', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    createHighlighterSpy.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not build the highlighter during module startup or plain fallback rendering', async () => {
    const { highlightToHtml } = await import('../src/markdown/highlight.ts')

    await vi.runOnlyPendingTimersAsync()
    expect(createHighlighterSpy).not.toHaveBeenCalled()
    expect(highlightToHtml('plain text', undefined)).toBeUndefined()
    expect(createHighlighterSpy).not.toHaveBeenCalled()

    expect(highlightToHtml('const answer = 42', 'ts')).toContain('shiki')
    expect(createHighlighterSpy).toHaveBeenCalledTimes(1)
  })
})
