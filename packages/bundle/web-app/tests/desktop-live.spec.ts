import { describe, it, expect } from 'vitest'
import { desktopLivePipeName, readDesktopLiveState } from '../src/desktop-live.ts'

describe('Desktop Live current-user bridge', () => {
  it('accepts only schema-1 named pipes created by the Phoenix Windows shell', () => {
    expect(desktopLivePipeName(JSON.stringify({
      schema: 1, pipeName: 'PhoenixDesktop.Browser.abcdef012345',
    }))).toBe('PhoenixDesktop.Browser.abcdef012345')
    expect(() => desktopLivePipeName(JSON.stringify({
      schema: 2, pipeName: 'PhoenixDesktop.Browser.abc',
    }))).toThrow(/compatible/i)
    expect(() => desktopLivePipeName(JSON.stringify({
      schema: 1, pipeName: '\\\\.\\pipe\\other',
    }))).toThrow(/compatible/i)
    expect(() => desktopLivePipeName('{}')).toThrow(/compatible/i)
  })

  it('does not claim a real Windows application is live without a broker', async () => {
    if (process.platform !== 'win32') {
      const state = await readDesktopLiveState('test-session')
      expect(state.available).toBe(false)
      expect(state.title).toBe('')
      expect(state.reason).toContain('sin conexión')
    }
  })
})
