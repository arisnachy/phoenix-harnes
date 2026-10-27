import { describe, expect, it } from 'vitest'
import { SystemPrefixObserver, SystemSectionObserver } from '../src/cache-prefix.ts'

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

describe('prefix comparison diagnostics and partial paragraph stability', () => {
  it('distinguishes the first request after startup from a measured 0 match', () => {
    const observer = new SystemPrefixObserver()
    expect(observer.observeWithStatus('codex', 'luna', 'alpha')).toEqual({
      comparable: false, reusedChars: 0,
    })
    expect(observer.observeWithStatus('codex', 'luna', 'omega')).toEqual({
      comparable: true, reusedChars: 0,
    })
    expect(new SystemPrefixObserver().observeWithStatus('codex', 'luna', 'alpha').comparable).toBe(false)
  })

  it('credits the stable part of a long first paragraph, without storing text', () => {
    const observer = new SystemPrefixObserver()
    const stable = 'persistent permission and identity instruction. '.repeat(25)
    observer.observe('codex', 'luna', stable + 'ACTIVE_MCP_LIST_A')
    const next = observer.observeWithStatus('codex', 'luna', stable + 'ACTIVE_MCP_LIST_B')
    expect(next.comparable).toBe(true)
    expect(next.reusedChars).toBeGreaterThanOrEqual(1024)
    expect(next.reusedChars).toBeLessThanOrEqual(stable.length)
    expect(JSON.stringify(observer)).not.toContain('persistent permission')
    expect(JSON.stringify(observer)).not.toContain('ACTIVE_MCP')
  })

  it('does not credit a shared suffix after the start changes', () => {
    const observer = new SystemPrefixObserver()
    observer.observe('codex', 'luna', 'X' + 'unchanged'.repeat(100))
    expect(observer.observeWithStatus('codex', 'luna', 'Y' + 'unchanged'.repeat(100)))
      .toEqual({ comparable: true, reusedChars: 0 })
  })

  it('treats route eviction as a fresh baseline', () => {
    const observer = new SystemPrefixObserver(1)
    observer.observe('codex', 'luna', 'same')
    observer.observe('codex', 'sol', 'other')
    expect(observer.observeWithStatus('codex', 'luna', 'same').comparable).toBe(false)
  })
})

describe('privacy-safe section change identification', () => {
  it('identifies changed SDK, rules and inserted sections per provider/model', () => {
    const observer = new SystemSectionObserver()
    const first = [
      { name: 'harness:identity', text: 'Stable identity' },
      { name: 'tools:sdk', text: 'Tool declarations A' },
    ]
    expect(observer.observe('codex', 'luna', first)).toBeUndefined()
    expect(observer.observe('codex', 'luna', [
      first[0]!, { name: 'tools:sdk', text: 'Tool declarations B' },
    ])).toBe('tools:sdk')
    expect(observer.observe('codex', 'sol', first)).toBeUndefined()
    expect(observer.observe('codex', 'luna', [
      { name: 'harness:identity', text: 'Updated identity' }, first[1]!,
    ])).toBe('harness:identity')
    expect(JSON.stringify(observer)).not.toContain('Tool declarations')
    expect(JSON.stringify(observer)).not.toContain('Stable identity')
  })
})
