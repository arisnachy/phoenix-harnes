import { afterEach, describe, expect, it, vi } from 'vitest'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => { await closeMockServers() })

describe('NVIDIA 410 automatic recovery', () => {
  it('replays a pre-output Gone exactly once on a compatible live replacement', async () => {
    const server = await mockServer([
      { status: 410, body: '' },
      { events: textEvents },
    ])
    const onModelUnavailable = vi.fn(async () => 'publisher/new-model')
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({
        nvidia: {
          api: 'openai-completions',
          baseURL: server.url,
          models: [{ id: 'publisher/old-model' }, { id: 'publisher/new-model' }],
        },
      }),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
      onModelUnavailable,
    })
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'nvidia',
      model: 'publisher/old-model',
      messages: [],
    })) chunks.push(chunk)
    expect(server.paths).toEqual(['/chat/completions', '/chat/completions'])
    expect(server.requests).toMatchObject([
      { model: 'publisher/old-model' },
      { model: 'publisher/new-model' },
    ])
    expect(onModelUnavailable).toHaveBeenCalledOnce()
    expect(chunks.filter(chunk => chunk.type === 'usage')).toHaveLength(1)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('preserves the Gone failure when no compatible alternative is known', async () => {
    const server = await mockServer([{ status: 410, body: '' }])
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({
        nvidia: {
          api: 'openai-completions',
          baseURL: server.url,
          models: [{ id: 'publisher/old-model' }],
        },
      }),
      resolveApiKey: () => Promise.resolve('test-key'),
      auth: memoryAuth(),
      onModelUnavailable: async () => undefined,
    })
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'nvidia', model: 'publisher/old-model', messages: [],
    })) chunks.push(chunk)
    expect(server.paths).toHaveLength(1)
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'MODEL_UNAVAILABLE' } },
    })
  })
})
