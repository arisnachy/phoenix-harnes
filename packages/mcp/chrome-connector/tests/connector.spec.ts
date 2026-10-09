import { describe, expect, it } from 'vitest'
import { buildDedicatedBrowserArgs, youtubeSearchUrl } from '../src/server.ts'

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
