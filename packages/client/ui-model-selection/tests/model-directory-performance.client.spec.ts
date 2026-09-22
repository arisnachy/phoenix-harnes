import { describe, expect, it, vi } from 'vitest'
import type { ModelSelection, SessionId, SessionModels } from '@phoenix-ai/dsh-api-remotes/client'
import { ModelDirectory } from '../src/client/directory.ts'

const sessionId = 'session-perf' as SessionId

const catalog: SessionModels = {
  current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  routable: true,
  groups: [{
    id: 'deepseek-official',
    name: 'DeepSeek',
    models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' }],
  }],
  failures: [],
}

describe('ModelDirectory performance', () => {
  it('starts Host catalog and Phoenix Local reads in parallel', async () => {
    let releaseModels!: () => void
    let releaseLocal!: () => void
    const modelsGate = new Promise<void>((resolve) => { releaseModels = resolve })
    const localGate = new Promise<void>((resolve) => { releaseLocal = resolve })
    const models = vi.fn(async () => {
      await modelsGate
      return { result: { ok: true as const, value: catalog } }
    })
    const local = vi.fn(async () => {
      await localGate
      return undefined
    })
    const directory = new ModelDirectory(
      { models, selectModel: vi.fn() } as never,
      sessionId,
      () => true,
      local,
    )

    const pending = directory.load()
    expect(models).toHaveBeenCalledTimes(1)
    expect(local).toHaveBeenCalledTimes(1)

    releaseModels()
    releaseLocal()
    await expect(pending).resolves.toMatchObject({ current: catalog.current })
  })

  it('reuses a fresh last-good catalog and coalesces simultaneous callers', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const models = vi.fn(async () => {
      await gate
      return { result: { ok: true as const, value: catalog } }
    })
    const directory = new ModelDirectory(
      { models, selectModel: vi.fn() } as never,
      sessionId,
      () => true,
      async () => undefined,
    )

    const first = directory.load()
    const second = directory.load()
    expect(models).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])

    await directory.load()
    expect(models).toHaveBeenCalledTimes(1)

    await directory.load({ force: true })
    expect(models).toHaveBeenCalledTimes(2)
  })

  it('keeps the cache aligned after a model selection', async () => {
    const selected: ModelSelection = {
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
    }
    const models = vi.fn(async () => ({ result: { ok: true as const, value: catalog } }))
    const selectModel = vi.fn(async () => ({
      result: { ok: true as const, value: { selected } },
    }))
    const directory = new ModelDirectory(
      { models, selectModel } as never,
      sessionId,
      () => true,
      async () => undefined,
    )

    await directory.load()
    await directory.select(selected)
    const cached = await directory.load()

    expect(cached.current).toEqual(selected)
    expect(models).toHaveBeenCalledTimes(1)
  })
})
