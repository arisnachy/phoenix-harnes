import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import LlmRuntime from '@phoenix-ai/dsh-llm'
import * as LlmPiAi from '@phoenix-ai/dsh-llm-pi-ai'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

describe('PHOENIX provider attribution', () => {
  it('identifies OpenRouter traffic as PHOENIX for app attribution', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        openrouter: {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: server.url,
          models: [{ id: 'openrouter/free' }],
        },
      },
    })

    await assemble(ctx, { provider: 'openrouter', model: 'openrouter/free', messages: [] })

    expect(server.headers[0]?.['user-agent']).toMatch(/^phoenix-harness\//)
    expect(server.headers[0]?.['http-referer']).toBe('https://github.com/arisnachy/phoenix-harnes')
    expect(server.headers[0]?.['x-title']).toBe('phoenix-harness')
  })

  it('keeps OpenRouter-only app headers off unrelated providers', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        acme: {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: server.url,
          models: [{ id: 'acme-model' }],
        },
      },
    })

    await assemble(ctx, { provider: 'acme', model: 'acme-model', messages: [] })

    expect(server.headers[0]?.['user-agent']).toMatch(/^phoenix-harness\//)
    expect(server.headers[0]?.['http-referer']).toBeUndefined()
    expect(server.headers[0]?.['x-title']).toBeUndefined()
  })
})