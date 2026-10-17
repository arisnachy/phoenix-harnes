import { describe, expect, it } from 'vitest'
import { buildDedicatedBrowserArgs, chooseTab, normalizeBrowserKey, youtubeSearchUrl } from '../src/server.ts'

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

  it('accepts common navigation keys and browser shortcuts with several modifier encodings', () => {
    expect(normalizeBrowserKey('PageDown')).toMatchObject({
      key: 'PageDown', virtualKeyCode: 34, modifiers: 0,
    })
    expect(normalizeBrowserKey('PgDn').key).toBe('PageDown')
    expect(normalizeBrowserKey('Shift+Tab')).toMatchObject({ key: 'Tab', modifiers: 8 })
    expect(normalizeBrowserKey('CTRL+F')).toMatchObject({ key: 'F', modifiers: 2, code: 'KeyF' })
    expect(normalizeBrowserKey('End', ['Control', 'Shift'])).toMatchObject({
      key: 'End', modifiers: 10,
    })
    expect(normalizeBrowserKey('Space')).toMatchObject({
      key: ' ', code: 'Space', text: ' ',
    })
    expect(normalizeBrowserKey('F5').virtualKeyCode).toBe(116)
    expect(normalizeBrowserKey('ArrowDown').virtualKeyCode).toBe(40)
    expect(normalizeBrowserKey('CTRL+END', 8).modifiers).toBe(10)
  })

  it('rejects invalid keyboard representations without dispatching arbitrary text', () => {
    expect(() => normalizeBrowserKey('Ctrl+unknown')).toThrow()
    expect(() => normalizeBrowserKey('Alt+bad+End')).toThrow()
    expect(() => normalizeBrowserKey('Enter', 'NotARealModifier')).toThrow()
    expect(() => normalizeBrowserKey('End', 16)).toThrow()
    expect(() => normalizeBrowserKey('')).toThrow()
  })

  it('does not fall back to another tab when an explicit id is missing', () => {
    const first = { id: 'first', title: 'First', url: 'https://example.com', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/first' }
    expect(() => chooseTab([first], 'missing')).toThrow('No existe la pestaña missing')
  })
})
