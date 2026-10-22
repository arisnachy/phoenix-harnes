import { describe, it, expect } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { desktopLivePipeName, readDesktopLiveFrame, readDesktopLiveState } from '../src/desktop-live.ts'

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

  it('exposes a recent computer screenshot only to the matching session, without claiming native live video', async () => {
    const sessionId = 'desktop-' + randomUUID()
    const secondSession = 'desktop-' + randomUUID()
    const directory = join(tmpdir(), 'phoenix-desktop-observations')
    const file = join(directory, createHash('sha256').update(sessionId).digest('hex') + '.png')
    // Minimal 1x1 PNG; only a previously produced real Computer frame is
    // written into this location in production.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9q4G6gAAAABJRU5ErkJggg==', 'base64')
    await mkdir(directory, { recursive: true })
    await writeFile(file, png)
    try {
      const own = await readDesktopLiveState(sessionId)
      expect(own.available).toBe(true)
      expect(own.source).toBe('observation')
      expect(own.title).toContain('captura')
      expect(await readDesktopLiveFrame(sessionId)).toEqual(png)
      const other = await readDesktopLiveState(secondSession)
      expect(other.available).toBe(false)
      await expect(readDesktopLiveFrame(secondSession)).rejects.toThrow(/captura/i)
    } finally {
      await rm(file, { force: true })
    }
  })

  it('does not claim a real Windows application is live without a broker', async () => {
    if (process.platform !== 'win32') {
      const state = await readDesktopLiveState('test-session')
      expect(state.available).toBe(false)
      expect(state.title).toBe('')
      expect(state.reason).toContain('captura verificada')
    }
  })
})
