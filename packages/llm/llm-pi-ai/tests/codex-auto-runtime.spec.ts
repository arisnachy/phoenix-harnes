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

  it('reuses a recent live catalog instead of spawning discovery for every selector read', async () => {
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
    await adapter.listModels('openai-codex')
    await adapter.resolveModel('openai-codex', 'gpt-future-auto')

    expect(discoverModels).toHaveBeenCalledTimes(1)
  })
})
