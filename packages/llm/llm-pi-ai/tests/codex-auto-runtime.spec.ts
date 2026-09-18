import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import LlmRuntime from '@phoenix-ai/dsh-llm'
import { PiAiAdapter } from '@phoenix-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

describe('Codex automatic runtime model discovery', () => {
  it('advertises a newly discovered Codex model without adding it to settings', async () => {
    const discoverModels = vi.fn(async () => [
      { id: 'gpt-future-auto', name: 'GPT Future Auto' },
    ])
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ 'openai-codex': {} }),
      resolveApiKey: () => Promise.resolve(undefined),
      auth: memoryAuth(),
      discoverModels,
    })

    const models = await adapter.listModels('openai-codex')

    expect(models).toContainEqual(expect.objectContaining({
      provider: 'openai-codex',
      id: 'gpt-future-auto',
      name: 'GPT Future Auto',
    }))
    expect(discoverModels).toHaveBeenCalledWith('openai-codex', undefined)
  })

  it('uses a newly discovered Codex model immediately instead of rejecting it as UNKNOWN_MODEL', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ status: 401, body: JSON.stringify({ error: { message: 'expected mock failure' } }) }])
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({
        'openai-codex': { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url },
      }),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
      discoverModels: () => Promise.resolve([
        { id: 'gpt-future-auto', name: 'GPT Future Auto' },
      ]),
    })
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['openai-codex'], adapter)

    const result = await assemble(ctx, {
      provider: 'openai-codex',
      model: 'gpt-future-auto',
      messages: [],
    })

    expect(result.finish.kind).toBe('error')
    expect(result.finish).not.toMatchObject({ failure: { code: 'UNKNOWN_MODEL' } })
    expect(server.paths).toEqual(['/responses'])
  })

  it('refreshes on each selector listing so a later Codex release appears without a Phoenix update', async () => {
    const discoverModels = vi.fn()
      .mockResolvedValueOnce([{ id: 'gpt-6-astra', name: 'GPT-6-Astra' }])
      .mockResolvedValueOnce([
        { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
        { id: 'gpt-6-sol', name: 'GPT-6-Sol' },
      ])
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ 'openai-codex': {} }),
      resolveApiKey: () => Promise.resolve(undefined),
      auth: memoryAuth(),
      discoverModels,
    })

    const before = await adapter.listModels('openai-codex')
    const after = await adapter.listModels('openai-codex')

    expect(before.map(model => model.id)).not.toContain('gpt-6-sol')
    expect(after.map(model => model.id)).toContain('gpt-6-sol')
    expect(discoverModels).toHaveBeenCalledTimes(2)
  })

  it('reuses a discovered live-only model for later turns without spawning Codex again', async () => {
    const discoverModels = vi.fn(async () => [
      { id: 'gpt-future-auto', name: 'GPT Future Auto' },
    ])
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ 'openai-codex': {} }),
      resolveApiKey: () => Promise.resolve(undefined),
      auth: memoryAuth(),
      discoverModels,
    })

    await adapter.listModels('openai-codex')
    await adapter.resolveModel('openai-codex', 'gpt-future-auto')
    await adapter.resolveModel('openai-codex', 'gpt-future-auto')

    expect(discoverModels).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good live catalog when a later selector refresh fails', async () => {
    const discoverModels = vi.fn()
      .mockResolvedValueOnce([{ id: 'gpt-future-auto', name: 'GPT Future Auto' }])
      .mockRejectedValueOnce(new Error('temporary Codex failure'))
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ 'openai-codex': {} }),
      resolveApiKey: () => Promise.resolve(undefined),
      auth: memoryAuth(),
      discoverModels,
    })

    const first = await adapter.listModels('openai-codex')
    const stale = await adapter.listModels('openai-codex')

    expect(first).toEqual(stale)
    expect(discoverModels).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent selector refreshes instead of launching duplicate Codex app-servers', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const discoverModels = vi.fn(async () => {
      await gate
      return [{ id: 'gpt-future-auto', name: 'GPT Future Auto' }]
    })
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ 'openai-codex': {} }),
      resolveApiKey: () => Promise.resolve(undefined),
      auth: memoryAuth(),
      discoverModels,
    })

    const first = adapter.listModels('openai-codex')
    const second = adapter.listModels('openai-codex')
    await Promise.resolve()
    expect(discoverModels).toHaveBeenCalledTimes(1)
    release?.()

    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(discoverModels).toHaveBeenCalledTimes(1)
  })
})
