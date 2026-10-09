import { afterEach, describe, expect, it } from 'vitest'
import { captureBrowserFrameWithFallback, miniBrowserRequestAllowed, normalizeMiniBrowserAddress } from '../src/mini-browser.ts'

afterEach(() => { /* Pure contracts: no live Chrome or network is required. */ })

describe('MiniBrowser capture recovery', () => {
  it('uses the visible viewport if an oversized screenshot clip is rejected', async () => {
    const calls: Record<string, unknown>[] = []
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(30).fill(1)]).toString('base64')
    const received = await captureBrowserFrameWithFallback(async options => {
      calls.push(options)
      if (calls.length === 1) throw new Error('Unable to capture screenshot')
      return { data: jpeg }
    })
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ captureBeyondViewport: false, fromSurface: true })
    expect(received.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]))
  })

  it('uses software capture when the first two methods fail', async () => {
    const methods: unknown[] = []
    const jpeg = Buffer.from([0xff, 0xd8, ...Array(30).fill(1)]).toString('base64')
    const received = await captureBrowserFrameWithFallback(async options => {
      methods.push(options.fromSurface)
      if (methods.length < 3) throw new Error('target surface missing')
      return { data: jpeg }
    })
    expect(methods).toEqual([true, true, false])
    expect(received[0]).toBe(0xff)
  })

  it('returns an actionable failure instead of inventing a screenshot', async () => {
    await expect(captureBrowserFrameWithFallback(async () => { throw new Error('Target closed') }))
      .rejects.toThrow('CDP_CAPTURE_FAILED')
  })
})

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
