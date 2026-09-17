import { describe, expect, it, vi } from 'vitest'
import { createLocalModelPaths } from '../src/local-model/paths.js'
import {
  createLocalModelRuntimeManager,
  type LocalModelRuntimeManagerDependencies,
  type LocalServerHandle,
} from '../src/local-model/manager.js'
import type { LocalModelPersistentState } from '../src/local-model/types.js'

/** Regression for stale runtime endpoint metadata after an unexpected llama-server exit. */
describe('Phoenix Local runtime exit cleanup', () => {
  it('removes pid, port, and baseUrl after the supervised process exits', async () => {
    let onExit: ((error?: Error) => void) | undefined
    const persistent: LocalModelPersistentState = {
      mode: 'on-demand',
      selectedModelId: 'qwen3.5-4b-q4-k-m',
      installedModelIds: ['qwen3.5-4b-q4-k-m'],
    }
    const server: LocalServerHandle = { pid: 4242, stop: vi.fn(async () => undefined) }
    const dependencies: LocalModelRuntimeManagerDependencies = {
      platform: 'win32',
      arch: 'x64',
      paths: createLocalModelPaths('C:\\PhoenixData\\local-models', 'win32'),
      stateStore: {
        load: vi.fn(async () => persistent),
        save: vi.fn(async () => undefined),
      },
      downloadArtifact: vi.fn(async request => ({ path: request.destinationPath, bytes: request.expectedSizeBytes ?? 0 })),
      extractArchive: vi.fn(async () => undefined),
      pathExists: vi.fn(async () => true),
      mkdir: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      allocatePort: vi.fn(async () => 17842),
      spawnServer: vi.fn((_executable, _args, callback) => {
        onExit = callback
        return server
      }),
      probeHealth: vi.fn(async () => undefined),
      freeMemoryBytes: vi.fn(() => 16_000_000_000),
    }
    const manager = await createLocalModelRuntimeManager(dependencies)
    await manager.ensureRunning()
    expect(manager.snapshot()).toMatchObject({
      phase: 'running',
      pid: 4242,
      port: 17842,
      baseUrl: 'http://127.0.0.1:17842/v1',
    })

    onExit?.(new Error('llama-server crashed'))

    expect(manager.snapshot()).toMatchObject({
      phase: 'error',
      error: { code: 'runtime-exited', message: 'llama-server crashed' },
    })
    expect(manager.snapshot().pid).toBeUndefined()
    expect(manager.snapshot().port).toBeUndefined()
    expect(manager.snapshot().baseUrl).toBeUndefined()
  })
})
