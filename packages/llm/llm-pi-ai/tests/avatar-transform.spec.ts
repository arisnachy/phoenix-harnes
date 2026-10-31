import type { Context } from '@phoenix-ai/cordis'
import { describe, expect, it } from 'vitest'
import { installCodexAvatarTransform } from '../src/image-generation.ts'

describe('private Codex avatar operation', () => {
  it('rejects malformed or oversized images before invoking any backend', async () => {
    let registered = ''
    let authority = ''
    let route: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const ctx = {
      connection: {
        rpc: {
          handle: (
            channel: string,
            handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>,
            options: { authority: string },
          ) => {
            registered = channel
            authority = options.authority
            route = handler
            return async () => {}
          },
        },
      },
    } as unknown as Context
    installCodexAvatarTransform(ctx)
    expect(registered).toBe('/avatar')
    expect(authority).toBe('loopback')
    if (route === undefined) throw new Error('Route was not registered')
    const signal = new AbortController().signal
    for (const request of [
      ['different', {}, 'bad-request'],
      ['transform', {}, 'bad-request'],
      ['transform', { image: '' }, 'bad-request'],
      ['transform', { image: 'AA==' }, 'bad-request'],
      ['transform', { image: 'a'.repeat(12_000_000) }, 'bad-request'],
    ] as const) {
      const result = await route(request[0], request[1], signal) as {
        ok: boolean
        error?: { code: string }
      }
      expect(result.ok).toBe(false)
      expect(result.error?.code).toBe(request[2])
    }
  })
})
