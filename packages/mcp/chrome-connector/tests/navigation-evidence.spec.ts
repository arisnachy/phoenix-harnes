import { describe, expect, it } from 'vitest'
import { classifyNavigationEvidence, type NavigationEvidence } from '../src/navigation-evidence.ts'

const sample: NavigationEvidence = {
  url: 'https://example.org/second?query=one',
  readyState: 'complete',
  title: 'Segundo sitio',
  visibleTextLength: 150,
  contentElements: 7,
}

describe('navigation receipt for independent MiniBrowser conversations', () => {
  it('does not claim that a second conversation loaded when Chrome is still blank', () => {
    expect(classifyNavigationEvidence('https://example.org/second?query=one', {
      ...sample, url: 'about:blank', visibleTextLength: 0, contentElements: 0,
    })).toBe('loading')
  })

  it('does not claim success when URL is present but DOM is empty', () => {
    expect(classifyNavigationEvidence(sample.url, {
      ...sample, visibleTextLength: 0, contentElements: 0,
    })).toBe('empty')
  })

  it('requires real content and a completed or interactive load', () => {
    expect(classifyNavigationEvidence(sample.url, { ...sample, readyState: 'loading' })).toBe('loading')
    expect(classifyNavigationEvidence(sample.url, sample)).toBe('verified')
    expect(classifyNavigationEvidence(sample.url, { ...sample, visibleTextLength: 0, contentElements: 1 })).toBe('verified')
  })

  it('does not confuse a different page on the same site with the requested page', () => {
    expect(classifyNavigationEvidence(sample.url, { ...sample, url: 'https://example.org/first' })).toBe('redirected')
    expect(classifyNavigationEvidence(sample.url, { ...sample, url: 'https://example.org/second?query=two' })).toBe('redirected')
    expect(classifyNavigationEvidence(sample.url, { ...sample, url: 'https://unrelated.org/second?query=one' })).toBe('redirected')
  })

  it('accepts harmless www and trailing-slash canonicalization', () => {
    expect(classifyNavigationEvidence('https://www.example.org/second/?query=one', sample)).toBe('verified')
  })
})
