import { describe, expect, it, vi } from 'vitest'
import type { IApiClient, RpcResponse } from '@phoenix-ai/dsh-api-remotes/client'
import { setChatGptWebEnabled } from '../src/client/chatgpt-web-toggle.ts'

let rpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `chatgpt-web-${String(rpc++)}` as never, result: { ok: true, value } }
}

function readySnapshot() {
  return {
    enabled: true,
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
          ops: [{ op: 'set', path: ['providers', 'chatgpt-web'], value: {} }],
        })
        return ok({})
      }),
    } as unknown as Pick<IApiClient['settings'], 'mutate'>

    const result = await setChatGptWebEnabled({ bridge, settings }, true)

    expect(result.phase).toBe('ready')
    expect(events).toEqual(['bridge:enable', 'settings:set'])
  })

  it('does not expose the route when browser-only setup is missing', async () => {
    const settings = { mutate: vi.fn() } as unknown as Pick<IApiClient['settings'], 'mutate'>
    const bridge = {
      enable: vi.fn(async () => ({
        enabled: false,
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
          ops: [{ op: 'unset', path: ['providers', 'chatgpt-web'] }],
        })
        return ok({})
      }),
    } as unknown as Pick<IApiClient['settings'], 'mutate'>
    const bridge = {
      enable: vi.fn(),
      disable: vi.fn(async () => {
        events.push('bridge:disable')
        return {
          enabled: false,
          phase: 'off' as const,
          baseUrl: 'http://127.0.0.1:17841/v1',
          detail: 'ChatGPT Web is off',
        }
      }),
    }

    const result = await setChatGptWebEnabled({ bridge, settings }, false)

    expect(result.phase).toBe('off')
    expect(events).toEqual(['settings:unset', 'bridge:disable'])
  })

  it('rolls the bridge back off when exposing the provider route fails', async () => {
    const bridge = {
      enable: vi.fn(async () => readySnapshot()),
      disable: vi.fn(async () => ({
        enabled: false,
        phase: 'off' as const,
        baseUrl: 'http://127.0.0.1:17841/v1',
        detail: 'ChatGPT Web is off',
      })),
    }
    const settings = {
      mutate: vi.fn(async () => ({
        rpcId: 'chatgpt-web-failure' as never,
        result: {
          ok: false as const,
          error: { code: 'settings-rejected', message: 'rejected' },
        },
      })),
    } as unknown as Pick<IApiClient['settings'], 'mutate'>

    await expect(setChatGptWebEnabled({ bridge, settings }, true)).rejects.toThrow('rejected')
    expect(bridge.disable).toHaveBeenCalledTimes(1)
  })
})
