import { describe, expect, it } from 'vitest'
import { SystemPrefixObserver } from '../src/cache-prefix.ts'

describe('system prompt prefix observer', () => {
  it('recognizes an identical prefix and ignores changing task-specific suffixes', () => {
    const observer = new SystemPrefixObserver()
    const staticPrefix = 'PHOENIX identity and policies.\n\nStable persona and permissions.'
    const first = staticPrefix + '\n\nSDK for all tools'
    const second = staticPrefix + '\n\nSDK for one discovered tool'
    expect(observer.observe('codex', 'luna', first)).toBe(0)
    expect(observer.observe('codex', 'luna', second)).toBe(staticPrefix.length)
    expect(observer.observe('codex', 'luna', second)).toBe(second.length)
  })

  it('never shares reuse attribution across models or provider routes', () => {
    const observer = new SystemPrefixObserver()
    const prefix = 'Stable policy\n\nShared instructions'
    expect(observer.observe('codex', 'luna', prefix)).toBe(0)
    expect(observer.observe('codex', 'sol', prefix)).toBe(0)
    expect(observer.observe('api', 'luna', prefix)).toBe(0)
    expect(observer.observe('codex', 'luna', prefix)).toBe(prefix.length)
    expect(observer.observe('codex', 'sol', prefix)).toBe(prefix.length)
  })

  it('keeps bounded route fingerprints, not raw prompts, after model changes', () => {
    const observer = new SystemPrefixObserver(2)
    expect(observer.observe('codex', 'a', 'PRIVATE PROMPT A')).toBe(0)
    expect(observer.observe('codex', 'b', 'PRIVATE PROMPT B')).toBe(0)
    expect(observer.observe('codex', 'c', 'PRIVATE PROMPT C')).toBe(0)
    expect(observer.observe('codex', 'a', 'PRIVATE PROMPT A')).toBe(0)
    expect(JSON.stringify(observer)).not.toContain('PRIVATE PROMPT')
  })
})
