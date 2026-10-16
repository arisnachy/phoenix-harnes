import { describe, expect, it } from 'vitest'
import { buildDedicatedBrowserArgs, chooseTab, youtubeSearchUrl } from '../src/server.ts'

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
    expect(args).toContain('--window-size=1280,820')
    expect(args).toContain('--force-device-scale-factor=1')
  })

  it('creates a direct YouTube results URL without separate open, type and submit operations', () => {
    expect(youtubeSearchUrl('  Bob Esponja  ')).toBe('https://www.youtube.com/results?search_query=Bob+Esponja')
    expect(youtubeSearchUrl('niños & música')).toBe('https://www.youtube.com/results?search_query=ni%C3%B1os+%26+m%C3%BAsica')
    expect(() => youtubeSearchUrl('  ')).toThrow(/1 y 256/)
    expect(() => youtubeSearchUrl('x'.repeat(257))).toThrow(/1 y 256/)
  })

  it('keeps headless mode explicit instead of forcing it on visual verification', () => {
    expect(buildDedicatedBrowserArgs('/tmp/phoenix-browser-test', true)).toContain('--headless=new')
    expect(buildDedicatedBrowserArgs('/tmp/phoenix-browser-test', true)).toContain('--mute-audio')
  })

  it('does not fall back to another tab when an explicit id is missing', () => {
    const first = { id: 'first', title: 'First', url: 'https://example.com', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/first' }
    expect(() => chooseTab([first], 'missing')).toThrow('No existe la pestaña missing')
  })
})
