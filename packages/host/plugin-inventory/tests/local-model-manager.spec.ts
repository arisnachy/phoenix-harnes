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
    selectedModelId: 'gemma-4-e2b-it-q4-0',
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
    probeOllamaModel: vi.fn(async () => undefined),
    freeMemoryBytes: vi.fn(() => 16_000_000_000),
  }
  return { dependencies, server, readState: () => persisted }
}

describe('LocalModelRuntimeManager', () => {
  it('accepts only thinking modes discovered in local Ollama metadata', async () => {
    const id = 'qwen3.5-2b-ollama-q4-k-m'
    const { dependencies, readState } = harness({ selectedModelId: id, thinking: false })
    dependencies.readOllamaThinking = vi.fn(async () => ({
      values: [false, true, 'medium'], default: false,
    }))
    const manager = await createLocalModelRuntimeManager(dependencies)
    await manager.refreshThinking()
    expect(manager.snapshot().thinkingCapabilities?.values).toEqual([false, true, 'medium'])
    await expect(manager.setThinking('high')).rejects.toThrow(/Ollama/)
    await manager.setThinking('medium')
    expect(readState().thinking).toBe('medium')
    await manager.setThinking(null)
    expect(readState().thinking).toBeNull()
  })

  it('installs the pinned runtime and recommended model with visible lifecycle phases', async () => {
    const { dependencies, readState } = harness()
    const manager = await createLocalModelRuntimeManager(dependencies)
    const phases: string[] = []
    manager.subscribe(snapshot => phases.push(snapshot.phase))

    await manager.install('gemma-4-e2b-it-q4-0')

    expect(phases).toContain('installing')
    expect(manager.snapshot().phase).toBe('ready')
    expect(readState().installedModelIds).toEqual(['gemma-4-e2b-it-q4-0'])
    expect(dependencies.downloadArtifact).toHaveBeenCalledTimes(2)
    expect(dependencies.extractArchive).toHaveBeenCalledTimes(1)
  })

  it('connects Qwen 2B from existing Ollama without downloading artifacts or spawning a child', async () => {
    const modelId = 'qwen3.5-2b-ollama-q4-k-m'
    const { dependencies, readState } = harness()
    const manager = await createLocalModelRuntimeManager(dependencies)
    await manager.install(modelId)
    expect(dependencies.probeOllamaModel).toHaveBeenCalledWith('qwen3.5:2b-q4_K_M')
    expect(dependencies.downloadArtifact).not.toHaveBeenCalled()
    expect(readState().selectedModelId).toBe(modelId)
    await expect(manager.ensureRunning()).resolves.toBe('http://127.0.0.1:11434/v1')
    expect(manager.snapshot()).toMatchObject({ phase: 'running', port: 11434 })
    expect(dependencies.spawnServer).not.toHaveBeenCalled()
    await manager.stop()
    expect(manager.snapshot().baseUrl).toBeUndefined()
    await manager.uninstall(modelId)
    expect(dependencies.remove).not.toHaveBeenCalled()
    expect(readState().installedModelIds).not.toContain(modelId)
  })

  it('fails with a clear Ollama error if the requested tag is absent', async () => {
    const { dependencies } = harness()
    dependencies.probeOllamaModel = vi.fn(async () => { throw new Error('missing Qwen') })
    const manager = await createLocalModelRuntimeManager(dependencies)
    await expect(manager.install('qwen3.5-2b-ollama-q4-k-m')).rejects.toMatchObject({
      code: 'ollama-unavailable',
    })
    expect(dependencies.downloadArtifact).not.toHaveBeenCalled()
  })

  it('starts llama-server on loopback and returns the OpenAI-compatible v1 endpoint', async () => {
    const { dependencies } = harness({ installedModelIds: ['gemma-4-e2b-it-q4-0'] })
    const manager = await createLocalModelRuntimeManager(dependencies)

    await expect(manager.ensureRunning()).resolves.toBe('http://127.0.0.1:17842/v1')

    expect(dependencies.spawnServer).toHaveBeenCalledTimes(1)
    const [executable, args] = vi.mocked(dependencies.spawnServer).mock.calls[0]!
    expect(executable).toContain('llama-server.exe')
    expect(args).toEqual(expect.arrayContaining([
      '--host', '127.0.0.1',
      '--port', '17842',
      '--ctx-size', '131072',
      '--cache-type-k', 'q8_0',
      '--cache-type-v', 'q8_0',
      '--model', expect.stringContaining('gemma-4-E2B-it-Q4_0.gguf'),
    ]))
    expect(args).not.toContain('--reasoning')
    expect(manager.snapshot()).toMatchObject({ phase: 'running', pid: 4242, port: 17842 })
  })

  it('keeps Qwen3.5-4B as an installable and selectable alternative', async () => {
    const qwen = 'qwen3.5-4b-q4-k-m'
    const gemma = 'gemma-4-e2b-it-q4-0'
    const { dependencies } = harness({ installedModelIds: [gemma, qwen] })
    const manager = await createLocalModelRuntimeManager(dependencies)

    await manager.setDefaultModel(qwen)
    await manager.ensureRunning()

    const [, args] = vi.mocked(dependencies.spawnServer).mock.calls[0]!
    expect(args).toEqual(expect.arrayContaining([
      '--ctx-size', '262144',
      '--reasoning', 'off',
      '--model', expect.stringContaining('Qwen_Qwen3.5-4B-Q4_K_M.gguf'),
    ]))
    expect(manager.snapshot().selectedModelId).toBe(qwen)
  })

  it('coalesces concurrent on-demand starts into one supervised llama-server', async () => {
    const { dependencies } = harness({ installedModelIds: ['gemma-4-e2b-it-q4-0'] })
    let releaseHealth: (() => void) | undefined
    dependencies.probeHealth = vi.fn(() => new Promise<void>((resolve) => { releaseHealth = resolve }))
    const manager = await createLocalModelRuntimeManager(dependencies)

    const first = manager.ensureRunning()
    const second = manager.ensureRunning()

    await vi.waitFor(() =>{  expect(dependencies.spawnServer).toHaveBeenCalledTimes(1) })
    releaseHealth?.()
    await expect(Promise.all([first, second])).resolves.toEqual([
      'http://127.0.0.1:17842/v1',
      'http://127.0.0.1:17842/v1',
    ])
    expect(dependencies.spawnServer).toHaveBeenCalledTimes(1)
  })

  it('does not start while local inference is switched off', async () => {
    const { dependencies } = harness({ mode: 'off', installedModelIds: ['gemma-4-e2b-it-q4-0'] })
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
    const { dependencies, server } = harness({ installedModelIds: ['gemma-4-e2b-it-q4-0'] })
    const manager = await createLocalModelRuntimeManager(dependencies)
    await manager.ensureRunning()
    await manager.stop()
    expect(server.stop).toHaveBeenCalledTimes(1)
    expect(manager.snapshot().phase).toBe('ready')
  })

  it('stops first and removes only Phoenix-managed artifacts when uninstalling the last model', async () => {
    const { dependencies, server } = harness({ installedModelIds: ['gemma-4-e2b-it-q4-0'] })
    const manager = await createLocalModelRuntimeManager(dependencies)
    await manager.ensureRunning()
    await manager.uninstall('gemma-4-e2b-it-q4-0')

    expect(server.stop).toHaveBeenCalledTimes(1)
    for (const [target] of vi.mocked(dependencies.remove).mock.calls) {
      expect(String(target).startsWith('C:\\PhoenixData\\local-models')).toBe(true)
    }
    expect(manager.snapshot().phase).toBe('not-installed')
  })
})
