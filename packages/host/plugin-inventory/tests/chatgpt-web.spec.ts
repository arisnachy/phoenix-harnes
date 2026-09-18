import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatGptWebIntegration, discoverChatGptWebLauncher, discoverChatGptWebRuntime } from '../src/chatgpt-web.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function enabledPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'phoenix-chatgpt-web-toggle-'))
  directories.push(directory)
  return join(directory, 'enabled.json')
}

describe('ChatGPT Web Windows discovery', () => {
  it('discovers the current codex-web-gpt-launcher install layout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phoenix-chatgpt-web-current-launcher-'))
    directories.push(directory)
    const launcherRoot = join(directory, 'Programs', 'codex-web-gpt-launcher')
    const runtimeRoot = join(launcherRoot, 'resources', 'runtime')
    await mkdir(join(runtimeRoot, 'runtime'), { recursive: true })
    await mkdir(join(runtimeRoot, 'app', 'node_modules', 'playwright-core'), { recursive: true })
    await writeFile(join(runtimeRoot, 'runtime', 'bun.exe'), '')
    await writeFile(join(runtimeRoot, 'app', 'cli.js'), '')
    await writeFile(join(runtimeRoot, 'app', 'node_modules', 'playwright-core', 'package.json'), '{}')
    await writeFile(join(launcherRoot, 'Codex Web GPT.exe'), '')

    expect(discoverChatGptWebRuntime({ LOCALAPPDATA: directory }, 'win32')).toEqual({
      command: [
        join(runtimeRoot, 'runtime', 'bun.exe'),
        join(runtimeRoot, 'app', 'cli.js'),
        'serve',
      ],
      cwd: join(runtimeRoot, 'app'),
    })
    expect(discoverChatGptWebLauncher({ LOCALAPPDATA: directory }, 'win32'))
      .toBe(join(launcherRoot, 'Codex Web GPT.exe'))
  })
})

describe('ChatGPT Web persisted integration', () => {
  it('opens first-time Browser-only setup once and preserves the requested ON state', async () => {
    const path = await enabledPath()
    const bridge = { start: vi.fn(), status: vi.fn(), stop: vi.fn() }
    const openSetup = vi.fn(() => true)
    const integration = new ChatGptWebIntegration({
      bridge,
      enabledPath: path,
      configured: false,
      baseUrl: 'http://127.0.0.1:17841/v1',
      openSetup,
      wait: async () => undefined,
    })

    await expect(integration.enable()).resolves.toMatchObject({ enabled: true, phase: 'needs-setup' })
    await expect(integration.enable()).resolves.toMatchObject({ enabled: true, phase: 'needs-setup' })
    expect(openSetup).toHaveBeenCalledTimes(1)
    expect(bridge.start).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ schema: 1, enabled: true })
  })

  it('keeps the switch OFF when no setup launcher can be opened', async () => {
    const path = await enabledPath()
    const bridge = { start: vi.fn(), status: vi.fn(), stop: vi.fn() }
    const integration = new ChatGptWebIntegration({
      bridge,
      enabledPath: path,
      configured: false,
      baseUrl: 'http://127.0.0.1:17841/v1',
      openSetup: () => false,
      wait: async () => undefined,
    })

    await expect(integration.enable()).resolves.toMatchObject({ enabled: false, phase: 'needs-setup' })
    expect(bridge.start).not.toHaveBeenCalled()
    await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('re-resolves bridge configuration after first-time setup completes', async () => {
    const path = await enabledPath()
    let configured = false
    const bridge = {
      start: vi.fn(async () => ({
        status: 'starting' as const,
        baseUrl: 'http://127.0.0.1:17841/v1',
        detail: 'starting',
      })),
      status: vi.fn(async () => ({
        status: 'ready' as const,
        baseUrl: 'http://127.0.0.1:17841/v1',
        detail: '1 model available',
      })),
      stop: vi.fn(async () => ({ status: 'stopped' as const })),
    }
    const openSetup = vi.fn(() => true)
    const integration = new ChatGptWebIntegration({
      bridge,
      enabledPath: path,
      configured: false,
      baseUrl: 'http://127.0.0.1:17841/v1',
      openSetup,
      resolve: () => ({
        bridge,
        configured,
        baseUrl: 'http://127.0.0.1:17841/v1',
      }),
      wait: async () => undefined,
    })

    await expect(integration.enable()).resolves.toMatchObject({ enabled: true, phase: 'needs-setup' })
    configured = true
    await expect(integration.enable()).resolves.toMatchObject({ enabled: true, phase: 'ready' })
    expect(openSetup).toHaveBeenCalledTimes(1)
    expect(bridge.start).toHaveBeenCalledTimes(1)
  })

  it('clears a pending ON state when the bridge stays unhealthy after setup completes', async () => {
    const path = await enabledPath()
    let configured = false
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
      configured: false,
      baseUrl: 'http://127.0.0.1:17841/v1',
      openSetup: () => true,
      resolve: () => ({
        bridge,
        configured,
        baseUrl: 'http://127.0.0.1:17841/v1',
      }),
      wait: async () => undefined,
    })

    await expect(integration.enable()).resolves.toMatchObject({ enabled: true, phase: 'needs-setup' })
    configured = true
    await expect(integration.enable()).resolves.toMatchObject({ enabled: false, phase: 'unavailable' })
    expect(bridge.stop).toHaveBeenCalledTimes(1)
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
