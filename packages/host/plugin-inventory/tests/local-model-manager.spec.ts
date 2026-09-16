import { describe, expect, it, vi } from 'vitest'
import { createLocalModelPaths } from '../src/local-model/paths.js'
import {
  createLocalModelRuntimeManager,
  type LocalModelRuntimeManagerDependencies,
  type LocalServerHandle,
} from '../src/local-model/manager.js'
import type { LocalModelPersistentState } from '../src/local-model/types.js'

function harness(initial?: Partial<LocalModelPersistentState>) {
  let persisted: LocalModelPersistentState = {
    mode: 'on-demand',
    selectedModelId: 'qwen3.5-4b-q4-k-m',
    installedModelIds: [],
    ...initial,
  }
  const server: LocalServerHandle = { pid: 4242, stop: vi.fn(async () => undefined) }
  const dependencies: LocalModelRuntimeManagerDependencies = {
    platform: 'win32',
    arch: 'x64',
    paths: createLocalModelPaths('C:\\PhoenixData\\local-models', 'win32'),
    stateStore: {
      load: vi.fn(async () => persisted),
      save: vi.fn(async (state: LocalModelPersistentState) => { persisted = structuredClone(state) }),
    },
    downloadArtifact: vi.fn(async request => ({ path: request.destinationPath, bytes: request.expectedSizeBytes ?? 0 })),
    extractArchive: vi.fn(async () => undefined),
    pathExists: vi.fn(async () => true),
    mkdir: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    allocatePort: vi.fn(async () => 17842),
    spawnServer: vi.fn(() => server),
    probeHealth: vi.fn(async () => undefined),
    freeMemoryBytes: vi.fn(() => 16_000_000_000),
  }
  return { dependencies, server, readState: () => persisted }
}

describe('LocalModelRuntimeManager', () => {
  it('installs the pinned runtime and recommended model with visible lifecycle phases', async () => {
    const { dependencies, readState } = harness()
    const manager = await createLocalModelRuntimeManager(dependencies)
    const phases: string[] = []
    manager.subscribe(snapshot => phases.push(snapshot.phase))

    await manager.install('qwen3.5-4b-q4-k-m')

    expect(phases).toContain('installing')
    expect(manager.snapshot().phase).toBe('ready')
    expect(readState().installedModelIds).toEqual(['qwen3.5-4b-q4-k-m'])
    expect(dependencies.downloadArtifact).toHaveBeenCalledTimes(2)
    expect(dependencies.extractArchive).toHaveBeenCalledTimes(1)
  })

  it('starts llama-server on loopback and returns the OpenAI-compatible v1 endpoint', async () => {
    const { dependencies } = harness({ installedModelIds: ['qwen3.5-4b-q4-k-m'] })
    const manager = await createLocalModelRuntimeManager(dependencies)

    await expect(manager.ensureRunning()).resolves.toBe('http://127.0.0.1:17842/v1')

    expect(dependencies.spawnServer).toHaveBeenCalledTimes(1)
    const [executable, args] = vi.mocked(dependencies.spawnServer).mock.calls[0]!
    expect(executable).toContain('llama-server.exe')
    expect(args).toEqual(expect.arrayContaining([
      '--host', '127.0.0.1',
      '--port', '17842',
      '--ctx-size', '8192',
      '--model', expect.stringContaining('Qwen_Qwen3.5-4B-Q4_K_M.gguf'),
    ]))
    expect(manager.snapshot()).toMatchObject({ phase: 'running', pid: 4242, port: 17842 })
  })

  it('does not start while local inference is switched off', async () => {
    const { dependencies } = harness({ mode: 'off', installedModelIds: ['qwen3.5-4b-q4-k-m'] })
    const manager = await createLocalModelRuntimeManager(dependencies)
    const promise = manager.ensureRunning()
    await expect(promise).rejects.toMatchObject({ code: 'local-model-disabled' })
    expect(dependencies.spawnServer).not.toHaveBeenCalled()
  })

  it('refuses to start when the selected model is not installed', async () => {
    const { dependencies } = harness()
    const manager = await createLocalModelRuntimeManager(dependencies)
    await expect(manager.ensureRunning()).rejects.toMatchObject({ code: 'model-not-installed' })
  })

  it('stops the supervised child without stopping the Phoenix host', async () => {
    const { dependencies, server } = harness({ installedModelIds: ['qwen3.5-4b-q4-k-m'] })
    const manager = await createLocalModelRuntimeManager(dependencies)
    await manager.ensureRunning()
    await manager.stop()
    expect(server.stop).toHaveBeenCalledTimes(1)
    expect(manager.snapshot().phase).toBe('ready')
  })

  it('stops first and removes only Phoenix-managed artifacts when uninstalling the last model', async () => {
    const { dependencies, server } = harness({ installedModelIds: ['qwen3.5-4b-q4-k-m'] })
    const manager = await createLocalModelRuntimeManager(dependencies)
    await manager.ensureRunning()
    await manager.uninstall('qwen3.5-4b-q4-k-m')

    expect(server.stop).toHaveBeenCalledTimes(1)
    for (const [target] of vi.mocked(dependencies.remove).mock.calls) {
      expect(String(target).startsWith('C:\\PhoenixData\\local-models')).toBe(true)
    }
    expect(manager.snapshot().phase).toBe('not-installed')
  })
})
