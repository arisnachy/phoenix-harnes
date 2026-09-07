import { describe, expect, it, vi } from 'vitest'
import type { CodexModelListTransport } from '../src/codex-discovery.ts'
import { readCodexModelPage } from '../src/codex-discovery.ts'
import { discoverModels } from '../src/discovery.ts'

describe('openai-codex live model discovery', () => {
  it('uses the live Codex catalog instead of the bundled pi-ai catalog', async () => {
    const list = vi.fn(async () => [
      { id: 'chatgpt-remote-only', name: 'ChatGPT Remote Only' },
      { id: 'gpt-6-astra', name: 'Astra' },
    ])
    const transport: CodexModelListTransport = { list }
    const storedApiKey = vi.fn(async () => {
      throw new Error('Codex discovery must not resolve an API key')
    })

    const models = await discoverModels(
      { provider: 'openai-codex' },
      storedApiKey,
      transport,
    )

    expect(models).toEqual([
      { id: 'chatgpt-remote-only', name: 'ChatGPT Remote Only' },
      { id: 'gpt-6-astra', name: 'Astra' },
    ])
    expect(list).toHaveBeenCalledOnce()
    expect(storedApiKey).not.toHaveBeenCalled()
  })

  it('fails loud when live Codex discovery fails instead of returning a stale static list', async () => {
    const transport: CodexModelListTransport = {
      list: vi.fn(async () => { throw new Error('live catalog unavailable') }),
    }

    await expect(discoverModels({ provider: 'openai-codex' }, undefined, transport))
      .rejects.toThrow('live catalog unavailable')
  })

  it('forwards cancellation to the live Codex transport', async () => {
    const controller = new AbortController()
    const list = vi.fn(async () => [])

    await discoverModels({ provider: 'openai-codex', signal: controller.signal }, undefined, { list })

    expect(list).toHaveBeenCalledWith(controller.signal)
  })
})

describe('Codex app-server model/list mapping', () => {
  it('uses the turn model value, keeps display names, skips hidden rows, and preserves pagination', () => {
    expect(readCodexModelPage({
      data: [
        { id: 'catalog-id', model: 'actual-turn-model', displayName: 'Actual model', hidden: false },
        { id: 'fallback-id', displayName: 'Legacy shape', hidden: false },
        { id: 'hidden-id', model: 'hidden-model', displayName: 'Hidden', hidden: true },
        { displayName: 'missing id' },
      ],
      nextCursor: 'cursor-2',
    })).toEqual({
      models: [
        { id: 'actual-turn-model', name: 'Actual model' },
        { id: 'fallback-id', name: 'Legacy shape' },
      ],
      nextCursor: 'cursor-2',
    })
  })

  it('refuses a malformed app-server response rather than inventing models', () => {
    expect(() => readCodexModelPage({ models: [] })).toThrow(/no data array/)
  })
})
