import { afterEach, describe, expect, it, vi } from 'vitest'
import { BinanceCloudPaperClient } from '../src/binance-cloud-bridge.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('PHOENIX Cloud PAPER client', () => {
  const auth = async () => 'test-only-cloud-token-012345678901234567890123456789'
  it('pins an HTTPS workers.dev endpoint to avoid private-network and redirect credential leaks', () => {
    for (const endpoint of [
      'http://phoenix.account.workers.dev/',
      'https://localhost/',
      'https://127.0.0.1/',
      'https://example.com/',
      'https://phoenix.account.workers.dev/evil',
      'https://admin:secret@phoenix.account.workers.dev/',
      'https://phoenix.account.workers.dev:8080/',
    ]) {
      expect(() => new BinanceCloudPaperClient(endpoint, auth)).toThrow()
    }
    expect(new BinanceCloudPaperClient('https://phoenix.account.workers.dev/', auth).endpoint)
      .toBe('https://phoenix.account.workers.dev')
  })

  it('sends bearer only to the pinned HTTPS host and rejects unverified REAL semantics', async () => {
    const seen: Array<{ url: string; authorization?: string; redirect?: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push({
        url, authorization: new Headers(init.headers).get('authorization') ?? undefined,
        redirect: init.redirect,
      })
      return new Response(JSON.stringify({ mode: 'paper', enabled: true, universeCount: 50 }), { status: 200 })
    }))
    const client = new BinanceCloudPaperClient('https://phoenix.account.workers.dev/', auth)
    expect(await client.snapshot()).toMatchObject({ mode: 'paper', enabled: true })
    expect(seen[0]?.url).toBe('https://phoenix.account.workers.dev/snapshot')
    expect(seen[0]?.authorization).toBe('Bearer ' + await auth())
    expect(seen[0]?.redirect).toBe('error')
  })

  it('paginates after durable sequence cursor and rejects malformed cloud event source', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      nextCursor: 11,
      events: [{ id: 'cloud:btc', seq: 11, kind: 'paper-entry',
        summary: 'Virtual entry BTCUSDT', at: 1_700_000_000_000, symbol: 'BTCUSDT' }],
    }), { status: 200 })))
    const client = new BinanceCloudPaperClient('https://phoenix.account.workers.dev/', auth)
    const result = await client.events(10)
    expect(result.nextCursor).toBe(11)
    expect(result.events).toMatchObject([{ id: 'cloud:btc', seq: 11, symbol: 'BTCUSDT' }])
    await expect(client.events(-1)).rejects.toThrow('Invalid Cloud PAPER cursor')
  })

  it('does not send a request when the Host vault has no remote token', async () => {
    const called = vi.fn()
    vi.stubGlobal('fetch', called)
    const client = new BinanceCloudPaperClient('https://phoenix.account.workers.dev/',
      async () => undefined)
    await expect(client.snapshot()).rejects.toThrow('ADMIN_TOKEN')
    expect(called).not.toHaveBeenCalled()
  })
})
