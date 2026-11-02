import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatGptWebIntegration } from '../src/chatgpt-web.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function enabledPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-chatgpt-web-toggle-'))
  directories.push(directory)
  return join(directory, 'enabled.json')
}

describe('ChatGPT Web persisted integration', () => {
  it('refuses ON until Browser-only setup exists', async () => {
    const path = await enabledPath()
    const bridge = { start: vi.fn(), status: vi.fn(), stop: vi.fn() }
    const integration = new ChatGptWebIntegration({
      bridge,
      enabledPath: path,
      configured: false,
      baseUrl: 'http://127.0.0.1:17841/v1',
      wait: async () => undefined,
    })

    await expect(integration.enable()).resolves.toMatchObject({ enabled: false, phase: 'needs-setup' })
    expect(bridge.start).not.toHaveBeenCalled()
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('persists ON only after the loopback health check succeeds', async () => {
    const path = await enabledPath()
    const bridge = {
      start: vi.fn(async () => ({
        status: 'starting' as const,
        baseUrl: 'http://127.0.0.1:17841/v1',
        detail: 'starting',
      })),
      status: vi.fn(async () => ({
        status: 'ready' as const,
        baseUrl: 'http://127.0.0.1:17841/v1',
        detail: '2 models available',
      })),
      stop: vi.fn(async () => ({ status: 'stopped' as const })),
    }
    const integration = new ChatGptWebIntegration({
      bridge,
      enabledPath: path,
      configured: true,
      baseUrl: 'http://127.0.0.1:17841/v1',
      wait: async () => undefined,
    })

    await expect(integration.enable()).resolves.toMatchObject({ enabled: true, phase: 'ready' })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ schema: 1, enabled: true })
    await expect(integration.disable()).resolves.toMatchObject({ enabled: false, phase: 'off' })
    expect(bridge.stop).toHaveBeenCalledTimes(1)
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stops an unhealthy start instead of persisting ON', async () => {
    const path = await enabledPath()
    const bridge = {
      start: vi.fn(async () => ({
        status: 'starting' as const,
        baseUrl: 'http://127.0.0.1:17841/v1',
        detail: 'starting',
      })),
      status: vi.fn(async () => ({
        status: 'starting' as const,
        baseUrl: 'http://127.0.0.1:17841/v1',
        detail: 'unreachable',
      })),
      stop: vi.fn(async () => ({ status: 'stopped' as const })),
    }
    const integration = new ChatGptWebIntegration({
      bridge,
      enabledPath: path,
      configured: true,
      baseUrl: 'http://127.0.0.1:17841/v1',
      wait: async () => undefined,
    })

    await expect(integration.enable()).resolves.toMatchObject({ enabled: false, phase: 'unavailable' })
    expect(bridge.stop).toHaveBeenCalledTimes(1)
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
