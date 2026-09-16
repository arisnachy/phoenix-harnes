import { describe, expect, it } from 'vitest'
import type { Config } from '../src/config.ts'
import { withCodexLiveCatalog } from '../src/codex-live-catalog.ts'

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
})
