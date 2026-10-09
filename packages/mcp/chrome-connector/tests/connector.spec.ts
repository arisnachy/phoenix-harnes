import { describe, expect, it } from 'vitest'
import { browserTaskOrigin, buildDedicatedBrowserArgs, safeBrowserFormScript, youtubeSearchUrl } from '../src/server.ts'

describe('Protected Chrome form and login actions', () => {
  it('only trusts exact secure origins', () => {
    expect(browserTaskOrigin('https://surveys.example/login?private=1')).toBe('https://surveys.example')
    expect(() => browserTaskOrigin('http://surveys.example')).toThrow()
    expect(() => browserTaskOrigin('https://someone:secret@surveys.example')).toThrow()
  })
  it('rejects malformed answer sets and generates a same-origin guarded action', () => {
    expect(() => safeBrowserFormScript('https://surveys.example', [], false)).toThrow()
    expect(() => safeBrowserFormScript('https://surveys.example',
      [{ field: 1, value: 'a', checked: true }], false)).toThrow()
    expect(() => safeBrowserFormScript('https://surveys.example', [{ field: -1, value: 'a' }], false)).toThrow()
    const script = safeBrowserFormScript('https://surveys.example', [{ field: 4, value: 'user answer' }], true)
    expect(script).toContain('location.origin !== expected')
    expect(script).toContain('Cross-origin submission refused')
    expect(script).toContain('password')
    expect(script).toContain('file')
    expect(script).toContain('read-page-required')
  })
})

describe('Chrome/Edge MCP connector entry', () => {
  it('imports without starting the stdio server', async () => {
    const connector = await import('../src/index.ts')
    expect(connector.startChromeConnector).toBeTypeOf('function')
  })

  it('launches the dedicated browser with an isolated Chrome 136+ CDP profile', () => {
    const profileDir = 'C:\\Temp\\phoenix-browser-test'
    const args = buildDedicatedBrowserArgs(profileDir)
    expect(args).toContain('--remote-debugging-port=0')
    expect(args).toContain('--remote-debugging-address=127.0.0.1')
    expect(args).toContain(`--user-data-dir=${profileDir}`)
    expect(args).not.toContain('--headless=new')
  })

  it('creates a direct YouTube results URL without separate open, type and submit operations', () => {
    expect(youtubeSearchUrl('  Bob Esponja  ')).toBe('https://www.youtube.com/results?search_query=Bob+Esponja')
    expect(youtubeSearchUrl('niños & música')).toBe('https://www.youtube.com/results?search_query=ni%C3%B1os+%26+m%C3%BAsica')
    expect(() => youtubeSearchUrl('  ')).toThrow(/1 y 256/)
    expect(() => youtubeSearchUrl('x'.repeat(257))).toThrow(/1 y 256/)
  })

  it('keeps headless mode explicit instead of forcing it on visual verification', () => {
    expect(buildDedicatedBrowserArgs('/tmp/phoenix-browser-test', true)).toContain('--headless=new')
  })
})
