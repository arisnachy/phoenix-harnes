import { describe, expect, it, vi } from 'vitest'
import { setChatGptWebEnabled } from '../src/client/chatgpt-web-toggle.ts'

function readySnapshot() {
  return {
    phase: 'ready' as const,
    baseUrl: 'http://127.0.0.1:17841/v1',
    detail: '2 models available',
  }
}

describe('ChatGPT Web settings toggle', () => {
  it('starts the healthy bridge before exposing the provider route', async () => {
    const events: string[] = []
    const bridge = {
      enable: vi.fn(async () => {
        events.push('bridge:enable')
        return readySnapshot()
      }),
      disable: vi.fn(),
    }
    const settings = {
      mutate: vi.fn(async (request: unknown) => {
        events.push('settings:set')
        expect(request).toMatchObject({
          ns: 'llm-pi-ai',
          operations: [{ op: 'set', path: ['providers', 'chatgpt-web'], value: {} }],
        })
      }),
    }

    const result = await setChatGptWebEnabled({ bridge, settings }, true)

    expect(result.phase).toBe('ready')
    expect(events).toEqual(['bridge:enable', 'settings:set'])
  })

  it('does not expose the route when browser-only setup is missing', async () => {
    const settings = { mutate: vi.fn() }
    const bridge = {
      enable: vi.fn(async () => ({
        phase: 'needs-setup' as const,
        baseUrl: 'http://127.0.0.1:17841/v1',
        detail: 'Complete Browser-only setup first',
      })),
      disable: vi.fn(),
    }

    const result = await setChatGptWebEnabled({ bridge, settings }, true)

    expect(result.phase).toBe('needs-setup')
    expect(settings.mutate).not.toHaveBeenCalled()
  })

  it('withdraws the provider route before stopping the bridge', async () => {
    const events: string[] = []
    const settings = {
      mutate: vi.fn(async (request: unknown) => {
        events.push('settings:unset')
        expect(request).toMatchObject({
          ns: 'llm-pi-ai',
          operations: [{ op: 'unset', path: ['providers', 'chatgpt-web'] }],
        })
      }),
    }
    const bridge = {
      enable: vi.fn(),
      disable: vi.fn(async () => {
        events.push('bridge:disable')
        return { phase: 'off' as const, detail: 'ChatGPT Web is off' }
      }),
    }

    const result = await setChatGptWebEnabled({ bridge, settings }, false)

    expect(result.phase).toBe('off')
    expect(events).toEqual(['settings:unset', 'bridge:disable'])
  })
})
