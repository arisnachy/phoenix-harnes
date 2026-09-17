import { describe, expect, it, vi } from 'vitest'
import { createLocalModelPaths, isManagedLocalModelPath } from '../src/local-model/paths.js'
import { createLocalModelStateStore } from '../src/local-model/state.js'

describe('Phoenix Local paths', () => {
  it('keeps managed artifacts inside the configured root', () => {
    const paths = createLocalModelPaths('C:\\PhoenixData\\local-models', 'win32')
    expect(paths.root).toBe('C:\\PhoenixData\\local-models')
    expect(isManagedLocalModelPath(paths, 'C:\\PhoenixData\\local-models\\models\\model.gguf')).toBe(true)
    expect(isManagedLocalModelPath(paths, 'C:\\Windows\\System32\\something.dll')).toBe(false)
  })
})

describe('Phoenix Local state', () => {
  it('defaults to on-demand with the recommended model selected', async () => {
    const readFile = vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    const store = createLocalModelStateStore({
      statePath: '/phoenix/local-models/state.json',
      readFile,
      writeFile: vi.fn(),
      rename: vi.fn(),
      mkdir: vi.fn(),
    })

    await expect(store.load()).resolves.toEqual({
      mode: 'on-demand',
      selectedModelId: 'qwen3.5-4b-q4-k-m',
      installedModelIds: [],
    })
  })

  it('persists atomically through a temporary file and rename', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined)
    const rename = vi.fn().mockResolvedValue(undefined)
    const mkdir = vi.fn().mockResolvedValue(undefined)
    const store = createLocalModelStateStore({
      statePath: '/phoenix/local-models/state.json',
      readFile: vi.fn(),
      writeFile,
      rename,
      mkdir,
    })

    await store.save({
      mode: 'off',
      selectedModelId: 'qwen3.5-4b-q4-k-m',
      installedModelIds: [],
    })

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(String(writeFile.mock.calls[0]?.[0])).toContain('state.json.tmp-')
    expect(rename).toHaveBeenCalledWith(expect.stringContaining('state.json.tmp-'), '/phoenix/local-models/state.json')
  })
})
