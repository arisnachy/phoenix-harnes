import { describe, it, expect, vi, afterEach } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import {
  verifyTheOddsApiKey,
  configureTheOddsApiConnector,
  theOddsApiConnectorState,
  disconnectTheOddsApiConnector,
} from '../src/odds-api-connector.ts'

const key = '0123456789abcdef0123456789abcdef'
const response = (status = 200, body: unknown = []) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (name: string) => name === 'x-requests-remaining'
      ? '487'
      : name === 'x-requests-used'
        ? '13'
        : null,
  },
  json: async () => body,
}) as unknown as Response

const makeContext = () => {
  const records = new Map<string, string>()
  const vault = {
    resolve: vi.fn(async (name: string) => records.has(name) ? { value: String(records.get(name)) } : undefined),
    set: vi.fn(async (name: string, value: string) => { records.set(name, value) }),
    unset: vi.fn(async (name: string) => { records.delete(name) }),
  }
  const ctx = new Context()
  ;(ctx as unknown as { provide(name: string, value: unknown): void }).provide('credentials', vault)
  return { ctx, vault, records }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('The Odds API secure connector', () => {
  it('validates on official zero-credit HTTPS sports endpoint and returns only quota', async () => {
    const request = vi.fn(async () => response())
    const state = await verifyTheOddsApiKey(key, request)
    expect(state).toEqual({ status: 'ready', verified: true, requestsRemaining: 487, requestsUsed: 13 })
    expect(request).toHaveBeenCalledWith(
      'https://api.the-odds-api.com/v4/sports/?apiKey=' + key,
      expect.objectContaining({ redirect: 'error', cache: 'no-store', method: 'GET' }),
    )
    expect(JSON.stringify(state)).not.toContain(key)
  })

  it('stores only after provider check, masks all secrets from connector state', async () => {
    const { ctx, records } = makeContext()
    const request = vi.fn(async () => response())
    const saved = await configureTheOddsApiConnector(ctx, key, request)
    expect(saved).toEqual({
      configured: true,
      source: 'vault',
      status: 'ready',
      verified: true,
      requestsRemaining: 487,
      requestsUsed: 13,
    })
    expect(records.get('THE_ODDS_API_KEY')).toBe(key)
    const state = await theOddsApiConnectorState(ctx, request)
    expect(state.verified).toBe(true)
    expect(JSON.stringify(state)).not.toContain(key)
  })

  it('does not overwrite a valid key when a new key is denied', async () => {
    const { ctx, records } = makeContext()
    records.set('THE_ODDS_API_KEY', key)
    await expect(configureTheOddsApiConnector(
      ctx,
      'abcdefabcdefabcdefabcdefabcdef12',
      vi.fn(async () => response(401)),
    )).rejects.toThrow('rechazó')
    expect(records.get('THE_ODDS_API_KEY')).toBe(key)
  })

  it('saves key as unverified during outage, never claims connection', async () => {
    const { ctx, records } = makeContext()
    const state = await configureTheOddsApiConnector(
      ctx,
      key,
      vi.fn(async () => { throw Error('Request failed with secret ' + key) }),
    )
    expect(state).toMatchObject({ configured: true, verified: false, status: 'unreachable' })
    expect(JSON.stringify(state)).not.toContain(key)
    expect(records.get('THE_ODDS_API_KEY')).toBe(key)
  })

  it('does not make any request with malformed credentials', async () => {
    const request = vi.fn()
    expect(await verifyTheOddsApiKey('bad key', request))
      .toMatchObject({ status: 'invalid-key' })
    expect(request).not.toHaveBeenCalled()
  })

  it('removes vault key, not an external environment variable', async () => {
    const { ctx, records } = makeContext()
    records.set('THE_ODDS_API_KEY', key)
    const state = await disconnectTheOddsApiConnector(ctx, vi.fn())
    expect(state).toMatchObject({ configured: false, status: 'unconfigured' })
    expect(records.size).toBe(0)
  })

  it('returns a secret-free vault unavailable status when credential storage cannot be read', async () => {
    const { ctx, vault } = makeContext()
    vault.resolve.mockRejectedValueOnce(Error('Secret store unavailable'))
    const state = await theOddsApiConnectorState(ctx, vi.fn())
    expect(state).toEqual({ configured: false, verified: false, source: 'none', status: 'vault-unavailable' })
  })

  it('does not report transient rate limits or provider errors as connected', async () => {
    const throttled = await verifyTheOddsApiKey(key, vi.fn(async () => response(429)))
    expect(throttled).toMatchObject({ status: 'rate-limited', verified: false })
    const upstream = await verifyTheOddsApiKey(key, vi.fn(async () => response(502)))
    expect(upstream).toMatchObject({ status: 'unreachable', verified: false })
    const malformed = await verifyTheOddsApiKey(key, vi.fn(async () => response(200, {})))
    expect(malformed).toMatchObject({ status: 'unreachable', verified: false })
  })

  it('refuses invalid keys without persisting them', async () => {
    const { ctx, records } = makeContext()
    await expect(configureTheOddsApiConnector(
      ctx, 'invalid key', vi.fn(),
    )).rejects.toThrow('API key')
    expect(records.size).toBe(0)
  })

  it('never sends a key to the network when vault is unavailable', async () => {
    const ctx = new Context()
    const request = vi.fn()
    await expect(configureTheOddsApiConnector(ctx, key, request))
      .rejects.toThrow('vault')
    await expect(disconnectTheOddsApiConnector(ctx, request))
      .rejects.toThrow('vault')
    expect(request).not.toHaveBeenCalled()
  })

  it('uses a temporary environment key only when no vault key exists', async () => {
    const previous = process.env.THE_ODDS_API_KEY
    const { ctx } = makeContext()
    const request = vi.fn(async () => response())
    try {
      process.env.THE_ODDS_API_KEY = key
      const state = await theOddsApiConnectorState(ctx, request)
      expect(state).toMatchObject({ configured: true, verified: true, source: 'environment' })
      const disconnected = await disconnectTheOddsApiConnector(ctx, request)
      expect(disconnected.source).toBe('environment')
    } finally {
      if (previous === undefined) delete process.env.THE_ODDS_API_KEY
      else process.env.THE_ODDS_API_KEY = previous
    }
  })

  it('safely rejects malicious quota headers and accepts only nonnegative safe integers', async () => {
    const request = vi.fn(async () => ({
      ...response(),
      headers: {
        get: (name: string) => name === 'x-requests-remaining'
          ? '999999999999999999999999'
          : name === 'x-requests-used' ? 'not-a-number' : name === 'x-requests-last' ? '0' : null,
      },
    } as unknown as Response))
    const state = await verifyTheOddsApiKey(key, request)
    expect(state).toEqual({ status: 'ready', verified: true, lastRequestCost: 0 })
  })

  it('distinguishes HTTP 403, response shape, and no vault state without leaking keys', async () => {
    expect(await verifyTheOddsApiKey(key, vi.fn(async () => response(403))))
      .toMatchObject({ status: 'invalid-key', verified: false })
    const ctx = new Context()
    const state = await theOddsApiConnectorState(ctx, vi.fn())
    expect(state).toMatchObject({ configured: false, verified: false, status: 'vault-unavailable' })
    expect(JSON.stringify(state)).not.toContain(key)
  })
})
