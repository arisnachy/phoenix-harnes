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

async function authorize(ctx: Context): Promise<ReturnType<typeof surface>> {
  internals.openLoopback = async () => ({
    redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
    code: Promise.resolve('authorization-code-private'),
    close: () => Promise.resolve(),
  })
  internals.fetch = (async () => tokenResponse()) as typeof fetch
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
  it('stores the OAuth grant durably while public credential and authorization views remain secret-free', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    const ui = await authorize(ctx)

    const record = await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)
    expect(record?.kind).toBe('grant')
    expect(JSON.stringify(record)).toContain('access-token-private')
    expect(JSON.stringify(record)).toContain('refresh-token-private')

    const described = await ctx.credentials.describeRecord(GOOGLE_ACCOUNT_KEY)
    expect(described).toEqual({ configured: true, kind: 'grant', writable: true })
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

  it('preserves the exact scopes Google granted and disables only capabilities the human did not consent to', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.resolve('code'),
      close: () => Promise.resolve(),
    })
    internals.fetch = (async () => tokenResponse({
      scope: 'openid email profile https://www.googleapis.com/auth/gmail.modify',
    })) as typeof fetch

    await expect(ctx.authorization.begin({ key: GOOGLE_ACCOUNT_KEY, interaction: surface().interaction }))
      .resolves.toEqual({ status: 'authorized' })

    await expect(ctx.googleApi.request({ service: 'drive', path: 'files' }))
      .rejects.toMatchObject({ code: 'GOOGLE_SCOPE_DENIED' })
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
    const result = await ctx.googleApi.request({
      service: 'gmail',
      path: 'users/me/messages?maxResults=1',
    })

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

  it('restores a durable grant without requiring an in-memory session', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    await ctx.credentials.modifyRecord(GOOGLE_ACCOUNT_KEY, () => Promise.resolve({
      kind: 'grant',
      payload: {
        version: 1,
        accessToken: 'restored-access-token',
        refreshToken: 'restored-refresh-token',
        expiresAt: 4_000_000,
        scopes: [...SCOPES],
      },
    }))
    let authorization: string | null = null
    internals.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get('authorization')
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    await expect(ctx.googleApi.request({ service: 'calendar', path: 'calendars/primary/events' }))
      .resolves.toMatchObject({ status: 200, ok: true })
    expect(authorization).toBe('Bearer restored-access-token')
  })

  it('refreshes an expired durable grant under modifyRecord and persists refresh-token rotation', async () => {
    const ctx = await harness()
    internals.now = () => 2_000_000
    await ctx.credentials.modifyRecord(GOOGLE_ACCOUNT_KEY, () => Promise.resolve({
      kind: 'grant',
      payload: {
        version: 1,
        accessToken: 'expired-access',
        refreshToken: 'old-refresh',
        expiresAt: 1_000_000,
        scopes: [...SCOPES],
      },
    }))
    const modifySpy = vi.spyOn(ctx.credentials, 'modifyRecord')
    let calls = 0
    internals.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      if (calls === 1) {
        expect(String(init?.body)).toContain('refresh_token=old-refresh')
        return tokenResponse({
          access_token: 'refreshed-access',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
        })
      }
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer refreshed-access')
      return new Response('{}', { status: 200 })
    }) as typeof fetch

    await ctx.googleApi.request({ service: 'drive', path: 'files?pageSize=1' })

    expect(modifySpy).toHaveBeenCalledWith(GOOGLE_ACCOUNT_KEY, expect.any(Function))
    const stored = JSON.stringify(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY))
    expect(stored).toContain('refreshed-access')
    expect(stored).toContain('rotated-refresh')
    expect(stored).not.toContain('old-refresh')
  })

  it('fails closed on caller-controlled destinations, credential headers, and missing consent', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    await authorize(ctx)

    await expect(ctx.googleApi.request({ service: 'gmail', path: '//evil.example/steal' }))
      .rejects.toMatchObject({ code: 'GOOGLE_PATH_DENIED' })
    await expect(ctx.googleApi.request({
      service: 'drive',
      path: 'files',
      headers: { Authorization: 'Bearer model-supplied-token' },
    })).rejects.toMatchObject({ code: 'GOOGLE_HEADER_DENIED' })
    await expect(ctx.googleApi.request({ service: 'calendar', path: 'https://evil.example/' }))
      .rejects.toMatchObject({ code: 'GOOGLE_PATH_DENIED' })
  })

  it('disconnects locally even if provider revocation fails and requires reauthorization afterward', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    await authorize(ctx)
    internals.fetch = (async () => { throw new Error('provider unavailable') }) as typeof fetch

    await expect(ctx.googleApi.disconnect()).resolves.toEqual({ revoked: false })
    expect(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)).toBeUndefined()
    await expect(ctx.googleApi.request({ service: 'gmail', path: 'users/me/messages' }))
      .rejects.toMatchObject({ code: 'GOOGLE_REAUTH_REQUIRED' })
  })
})
