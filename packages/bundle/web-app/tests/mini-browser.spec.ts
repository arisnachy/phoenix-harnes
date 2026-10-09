import { afterEach, describe, expect, it } from 'vitest'
import { miniBrowserRequestAllowed, normalizeMiniBrowserAddress } from '../src/mini-browser.ts'

afterEach(() => { /* Pure contracts: no live Chrome or network is required. */ })

describe('MiniBrowser origin and navigation contracts', () => {
  const allowed = {
    remoteAddress: '127.0.0.1',
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    marker: '1',
    fetchSite: 'same-origin',
  }
  it('accepts only a deliberate, same-origin loopback browser request', () => {
    expect(miniBrowserRequestAllowed(allowed)).toBe(true)
    expect(miniBrowserRequestAllowed({ ...allowed, remoteAddress: '::ffff:127.0.0.1' })).toBe(true)
    expect(miniBrowserRequestAllowed({ ...allowed, marker: undefined })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, remoteAddress: '10.0.0.3' })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, host: 'evil.example:3080' })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, origin: 'https://evil.example' })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, fetchSite: 'cross-site' })).toBe(false)
  })
  it('converts hostnames and searches but refuses executable schemes and credential URLs', () => {
    expect(normalizeMiniBrowserAddress('youtube.com')).toBe('https://youtube.com/')
    expect(normalizeMiniBrowserAddress('http://127.0.0.1:3080/test')).toBe('http://127.0.0.1:3080/test')
    expect(normalizeMiniBrowserAddress('Bob Esponja')).toContain('https://www.google.com/search?q=Bob%20Esponja')
    expect(() => normalizeMiniBrowserAddress('https://user:password@example.org')).toThrow('HTTP(S)')
    expect(() => normalizeMiniBrowserAddress('')).toThrow()
    expect(() => normalizeMiniBrowserAddress('http://')).toThrow()
  })
})
