import { describe, expect, it, vi } from 'vitest'
import type { LlmDiscoveredModel } from '@phoenix-ai/dsh-llm'
import { CodexAutoRefreshingPiAiAdapter } from '../src/codex-auto-adapter.ts'
import type { Config } from '../src/config.ts'
import { resolveProfiles } from '../src/config.ts'
import { withCodexLiveCatalog } from '../src/codex-live-catalog.ts'
import { memoryAuth } from './auth-double.ts'

describe('automatic Codex model catalog', () => {
  it('adds newly discovered Codex models while preserving manual model tuning', () => {
    const config: Config = {
      providers: {
        'openai-codex': {
          models: [
            { id: 'gpt-6-astra', maxTokens: 65536 },
          ],
          modelOverrides: {
            'gpt-5.6-sol': { contextWindow: 200000 },
          },
        },
      },
    }

    const next = withCodexLiveCatalog(config, [
      { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol' },
      { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
      { id: 'gpt-6-sol', name: 'GPT-6-Sol' },
    ])

    expect(next.providers?.['openai-codex']?.models).toEqual([
      { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', contextWindow: 200000 },
      { id: 'gpt-6-astra', name: 'GPT-6-Astra', maxTokens: 65536 },
      { id: 'gpt-6-sol', name: 'GPT-6-Sol' },
    ])
    expect(next.providers?.['openai-codex']?.modelOverrides).toBeUndefined()
  })

  it('does not activate Codex just because the CLI is installed', () => {
    const config: Config = { providers: { openrouter: {} } }

    expect(withCodexLiveCatalog(config, [{ id: 'gpt-6-sol', name: 'GPT-6-Sol' }])).toBe(config)
  })

  it('keeps the last configured catalog when discovery returns no models', () => {
    const config: Config = {
      providers: {
        'openai-codex': {
          models: [{ id: 'gpt-6-astra', name: 'GPT-6-Astra' }],
        },
      },
    }

    expect(withCodexLiveCatalog(config, [])).toBe(config)
  })

  it('refreshes Codex before a selector lists models', async () => {
    const config: Config = { providers: { 'openai-codex': {} } }
    let live: readonly LlmDiscoveredModel[] = []
    const refresh = vi.fn(async () => {
      live = [{ id: 'future-codex-model', name: 'Future Codex Model' }]
    })
    const adapter = new CodexAutoRefreshingPiAiAdapter({
      profiles: () => resolveProfiles(withCodexLiveCatalog(config, live).providers),
      resolveApiKey: async () => undefined,
      auth: memoryAuth(),
    }, refresh)

    const models = await adapter.listModels('openai-codex')

    expect(refresh).toHaveBeenCalledOnce()
    expect(models).toContainEqual(expect.objectContaining({
      provider: 'openai-codex',
      id: 'future-codex-model',
      name: 'Future Codex Model',
    }))
  })

  it('refreshes and retries when a Codex model id is newer than the current snapshot', async () => {
    const config: Config = { providers: { 'openai-codex': {} } }
    let live: readonly LlmDiscoveredModel[] = []
    const refresh = vi.fn(async () => {
      live = [{ id: 'future-codex-model', name: 'Future Codex Model' }]
    })
    const adapter = new CodexAutoRefreshingPiAiAdapter({
      profiles: () => resolveProfiles(withCodexLiveCatalog(config, live).providers),
      resolveApiKey: async () => undefined,
      auth: memoryAuth(),
    }, refresh)

    const model = await adapter.resolveModel('openai-codex', 'future-codex-model')

    expect(refresh).toHaveBeenCalledOnce()
    expect(model).toMatchObject({
      provider: 'openai-codex',
      id: 'future-codex-model',
      name: 'Future Codex Model',
    })
  })
})
