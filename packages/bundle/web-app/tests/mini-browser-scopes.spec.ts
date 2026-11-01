import { describe, expect, it } from 'vitest'
import { MiniBrowserScopes, validBrowserScopeId } from '../src/mini-browser-scopes.ts'

describe('MiniBrowser per-conversation isolation', () => {
  it('never adopts the globally selected Chrome tab for an unrelated conversation', () => {
    const scopes = new MiniBrowserScopes()
    scopes.claim('chat-a', 'chrome-a')
    expect(scopes.choose('chat-b', ['chrome-a'])).toBeUndefined()
    scopes.claim('chat-b', 'chrome-b')
    expect(scopes.choose('chat-a', ['chrome-a', 'chrome-b'])).toBe('chrome-a')
    expect(scopes.choose('chat-b', ['chrome-a', 'chrome-b'])).toBe('chrome-b')
    expect(scopes.tabs('chat-a', ['chrome-a', 'chrome-b'])).toEqual(['chrome-a'])
    expect(scopes.tabs('chat-b', ['chrome-a', 'chrome-b'])).toEqual(['chrome-b'])
  })

  it('refuses cross-conversation target hijacking through an explicit Chrome tool tab ID', () => {
    const scopes = new MiniBrowserScopes()
    scopes.claim('chat-a', 'owned-a')
    expect(() => scopes.claim('chat-b', 'owned-a')).toThrow('otra conversación')
    expect(() => scopes.choose('chat-b', ['owned-a'], 'owned-a')).toThrow('otra conversación')
    expect(() => scopes.select('chat-b', 'owned-a')).toThrow('no pertenece')
    expect(() => scopes.release('chat-b', 'owned-a')).toThrow('no pertenece')
    expect(scopes.owns('chat-a', 'owned-a')).toBe(true)
  })

  it('keeps independent multi-tab navigation and restores it after restart', () => {
    const scopes = new MiniBrowserScopes()
    scopes.claim('chat-a', 'a1')
    scopes.claim('chat-a', 'a2')
    scopes.claim('chat-b', 'b1')
    scopes.select('chat-a', 'a1')
    const restored = new MiniBrowserScopes(scopes.snapshot())
    expect(restored.choose('chat-a', ['a1', 'a2', 'b1'])).toBe('a1')
    expect(restored.choose('chat-b', ['a1', 'a2', 'b1'])).toBe('b1')
    restored.release('chat-a', 'a1')
    expect(restored.choose('chat-a', ['a2', 'b1'])).toBe('a2')
    expect(restored.choose('chat-b', ['a2', 'b1'])).toBe('b1')
  })

  it('purges disappeared Chrome tabs without transferring ownership to another chat', () => {
    const scopes = new MiniBrowserScopes()
    scopes.claim('chat-a', 'gone')
    scopes.claim('chat-b', 'stay')
    expect(scopes.choose('chat-a', ['stay'])).toBeUndefined()
    expect(scopes.choose('chat-b', ['stay'])).toBe('stay')
    expect(scopes.owns('chat-a', 'gone')).toBe(false)
  })

  it('validates and sanitizes restored session and tab identities', () => {
    expect(validBrowserScopeId('session-123:abc')).toBe(true)
    expect(validBrowserScopeId('../../etc/passwd')).toBe(false)
    const scopes = new MiniBrowserScopes({
      'chat-a': { tabIds: ['owned', 'owned', '<script>'], selectedTabId: 'owned' },
      'chat-b': { tabIds: ['owned', 'own-b'] },
    })
    expect(scopes.tabs('chat-a', ['owned', 'own-b'])).toEqual(['owned'])
    expect(scopes.tabs('chat-b', ['owned', 'own-b'])).toEqual(['own-b'])
  })
  it('does not prune the other chat when Chromium instances have disjoint target lists', () => {
    const scopes = new MiniBrowserScopes()
    scopes.claim('chat-a', 'instance-a-page')
    scopes.claim('chat-b', 'instance-b-page')
    expect(scopes.choose('chat-a', ['instance-a-page'])).toBe('instance-a-page')
    expect(scopes.owns('chat-b', 'instance-b-page')).toBe(true)
    expect(scopes.choose('chat-b', ['instance-b-page'])).toBe('instance-b-page')
    expect(scopes.owns('chat-a', 'instance-a-page')).toBe(true)
  })

})
