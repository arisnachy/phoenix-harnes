import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import GoogleApiBroker, {
  GOOGLE_ACCOUNT_KEY,
  internals,
  resolveGoogleSpec,
} from '@deepseek-ai/dsh-authorization/google'
import { MemoryCredentials } from './memory.ts'

const originalFetch = internals.fetch
const originalNow = internals.now
const originalOpenLoopback = internals.openLoopback

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/contacts',
] as const

function googleApi(ctx: Context): GoogleApiBroker {
  const service = ctx.get('googleApi')
  if (!(service instanceof GoogleApiBroker)) throw new Error('Google API broker is not mounted')
  return service
}

function surface() {
  const notices: Array<{ message: string; url?: string }> = []
  return {
    notices,
    interaction: {
      notify(notice: { message: string; url?: string }) { notices.push(notice) },
      prompt: () => Promise.reject(new Error('Google loopback flow must not ask for a pasted secret')),
    },
  }
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(GoogleApiBroker, { clientId: 'client.apps.googleusercontent.com', scopes: SCOPES })
  return ctx
}

function tokenResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    access_token: 'access-token-private',
    refresh_token: 'refresh-token-private',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: SCOPES.join(' '),
    ...overrides,
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function authorize(ctx: Context, overrides: Record<string, unknown> = {}): Promise<ReturnType<typeof surface>> {
  internals.openLoopback = async () => ({
    redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
    code: Promise.resolve('authorization-code-private'),
    close: () => Promise.resolve(),
  })
  internals.fetch = (async () => tokenResponse(overrides)) as typeof fetch
  const ui = surface()
  await expect(ctx.authorization.begin({ key: GOOGLE_ACCOUNT_KEY, interaction: ui.interaction }))
    .resolves.toEqual({ status: 'authorized' })
  return ui
}

afterEach(() => {
  internals.fetch = originalFetch
  internals.now = originalNow
  internals.openLoopback = originalOpenLoopback
  vi.restoreAllMocks()
})

describe('Google Workspace OAuth configuration', () => {
  it('requires explicit unique scopes and treats the Desktop client id as public deployment identity', () => {
    expect(resolveGoogleSpec({ scopes: ['openid', 'email'] })).toEqual({ scopes: ['openid', 'email'] })
    expect(resolveGoogleSpec({ clientId: '  desktop.apps.googleusercontent.com  ', scopes: ['openid'] })).toEqual({
      clientId: 'desktop.apps.googleusercontent.com',
      scopes: ['openid'],
    })
    expect(() => resolveGoogleSpec({ scopes: [] })).toThrow(/at least one OAuth scope/)
    expect(() => resolveGoogleSpec({ scopes: ['email', 'email'] })).toThrow(/must not contain duplicates/)
  })
})

describe('Google Workspace OAuth authorization boundary', () => {
  it('persists only a secret-free marker while tokens, verifier, and authorization code stay Host-only', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    const ui = await authorize(ctx)

    const record = await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)
    expect(record).toEqual({ kind: 'api-key' })
    expect(JSON.stringify(record)).not.toMatch(/access-token|refresh-token|authorization-code/)

    const described = await ctx.credentials.describeRecord(GOOGLE_ACCOUNT_KEY)
    expect(described).toEqual({ configured: true, kind: 'api-key', writable: true })
    expect(JSON.stringify(described)).not.toMatch(/access-token|refresh-token|authorization-code/)

    expect(ctx.authorization.list()).toEqual([{
      key: GOOGLE_ACCOUNT_KEY,
      label: 'Google Workspace',
      methods: [{ id: 'oauth', label: 'Sign in with Google' }],
      inFlight: false,
    }])
    expect(await ctx.authorization.inspect(GOOGLE_ACCOUNT_KEY)).toEqual({
      kind: 'account',
      provider: 'google',
      accountType: 'oauth',
    })
    expect(JSON.stringify(await ctx.authorization.inspect(GOOGLE_ACCOUNT_KEY)))
      .not.toMatch(/access-token|refresh-token|authorization-code/)

    expect(ui.notices).toHaveLength(1)
    expect(ui.notices[0]?.url).toContain('accounts.google.com/o/oauth2/v2/auth')
    expect(ui.notices[0]?.url).toContain('code_challenge_method=S256')
    expect(ui.notices[0]?.url).not.toContain('authorization-code-private')
  })

  it('preserves the exact scopes Google granted in Host memory and denies capabilities not consented to', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    await authorize(ctx, {
      scope: 'openid email profile https://www.googleapis.com/auth/gmail.modify',
    })

    await expect(googleApi(ctx).request({ service: 'drive', path: 'files' }))
      .rejects.toMatchObject({ code: 'GOOGLE_SCOPE_DENIED' })
    expect(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)).toEqual({ kind: 'api-key' })
  })

  it('rejects a mismatched OAuth state before accepting an authorization code', async () => {
    const controller = new AbortController()
    const receiver = await originalOpenLoopback('expected-state', controller.signal)
    const rejected = expect(receiver.code).rejects.toMatchObject({ code: 'GOOGLE_STATE_MISMATCH' })
    const callback = new URL(receiver.redirectUri)
    callback.searchParams.set('state', 'wrong-state')
    callback.searchParams.set('code', 'must-not-be-accepted')

    const response = await fetch(callback)
    expect(response.status).toBe(400)
    await rejected
    await receiver.close()
  })
})

describe('Google Workspace API broker', () => {
  it('injects Bearer only at the fixed Google service boundary and never returns it', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    let calls = 0
    let seenUrl = ''
    let seenAuthorization: string | null = null
    let seenRedirect: RequestRedirect | undefined
    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.resolve('code'),
      close: () => Promise.resolve(),
    })
    internals.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      if (calls === 1) return tokenResponse()
      seenUrl = String(input)
      seenAuthorization = new Headers(init?.headers).get('authorization')
      seenRedirect = init?.redirect
      return new Response(JSON.stringify({ messages: [{ id: 'm1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    await ctx.authorization.begin({ key: GOOGLE_ACCOUNT_KEY, interaction: surface().interaction })
    const result = await googleApi(ctx).request({ service: 'gmail', path: 'users/me/messages?maxResults=1' })

    expect(seenUrl).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1')
    expect(seenAuthorization).toBe('Bearer access-token-private')
    expect(seenRedirect).toBe('error')
    expect(result).toEqual({
      status: 200,
      ok: true,
      contentType: 'application/json',
      body: JSON.stringify({ messages: [{ id: 'm1' }] }),
    })
    expect(JSON.stringify(result)).not.toMatch(/access-token-private|refresh-token-private/)
  })

  it('does not restore a Google session from the durable marker after a process restart', async () => {
    const ctx = await harness()
    await ctx.credentials.modifyRecord(GOOGLE_ACCOUNT_KEY, () => Promise.resolve({ kind: 'api-key' }))

    await expect(googleApi(ctx).request({ service: 'calendar', path: 'calendars/primary/events' }))
      .rejects.toMatchObject({ code: 'GOOGLE_REAUTH_REQUIRED' })
    expect(await ctx.authorization.inspect(GOOGLE_ACCOUNT_KEY)).toBeUndefined()
  })

  it('refreshes an expired token in Host memory and never persists rotated refresh material', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    await authorize(ctx, { expires_in: 1 })

    internals.now = () => 2_000_000
    let calls = 0
    internals.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      if (calls === 1) {
        expect(String(init?.body)).toContain('refresh_token=refresh-token-private')
        return tokenResponse({
          access_token: 'refreshed-access',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
        })
      }
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer refreshed-access')
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    await googleApi(ctx).request({ service: 'drive', path: 'files?pageSize=1' })

    expect(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)).toEqual({ kind: 'api-key' })
    expect(JSON.stringify(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)))
      .not.toMatch(/refreshed-access|rotated-refresh|refresh-token-private/)
  })

  it('fails closed on caller-controlled destinations and credential headers', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    await authorize(ctx)

    await expect(googleApi(ctx).request({ service: 'gmail', path: '//evil.example/steal' }))
      .rejects.toMatchObject({ code: 'GOOGLE_PATH_DENIED' })
    await expect(googleApi(ctx).request({
      service: 'drive',
      path: 'files',
      headers: { Authorization: 'Bearer model-supplied-token' },
    })).rejects.toMatchObject({ code: 'GOOGLE_HEADER_DENIED' })
    await expect(googleApi(ctx).request({ service: 'calendar', path: 'https://evil.example/' }))
      .rejects.toMatchObject({ code: 'GOOGLE_PATH_DENIED' })
  })

  it('disconnects locally even if provider revocation fails and requires reauthorization afterward', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    await authorize(ctx)
    internals.fetch = (async () => { throw new Error('provider unavailable') }) as typeof fetch

    await expect(googleApi(ctx).disconnect()).resolves.toEqual({ revoked: false })
    expect(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)).toBeUndefined()
    await expect(googleApi(ctx).request({ service: 'gmail', path: 'users/me/messages' }))
      .rejects.toMatchObject({ code: 'GOOGLE_REAUTH_REQUIRED' })
  })
})