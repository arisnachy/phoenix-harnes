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
  'https://www.googleapis.com/auth/gmail.modify',
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

afterEach(() => {
  internals.fetch = originalFetch
  internals.now = originalNow
  internals.openLoopback = originalOpenLoopback
  vi.restoreAllMocks()
})

describe('Google OAuth broker configuration', () => {
  it('requires explicit, unique scopes while allowing a discoverable unconfigured client', () => {
    expect(resolveGoogleSpec({ scopes: ['openid', 'email'] })).toEqual({
      scopes: ['openid', 'email'],
    })
    expect(() => resolveGoogleSpec({ scopes: [] })).toThrow(/at least one OAuth scope/)
    expect(() => resolveGoogleSpec({ scopes: ['email', 'email'] })).toThrow(/must not contain duplicates/)
  })
})

describe('Google OAuth broker authorization', () => {
  it('commits only a marker while keeping access, refresh, code verifier, and authorization code out of the credential store', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.resolve('authorization-code-must-not-persist'),
      close: () => Promise.resolve(),
    })
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      access_token: 'access-token-must-not-persist',
      refresh_token: 'refresh-token-must-not-persist',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: SCOPES.join(' '),
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    internals.fetch = fetchSpy as typeof fetch
    const ui = surface()

    await expect(ctx.authorization.begin({ key: GOOGLE_ACCOUNT_KEY, interaction: ui.interaction }))
      .resolves.toEqual({ status: 'authorized' })

    expect(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)).toEqual({ kind: 'api-key' })
    expect(JSON.stringify(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY))).not.toMatch(/access-token|refresh-token|authorization-code/)
    expect(ui.notices).toHaveLength(1)
    expect(ui.notices[0]?.url).toContain('accounts.google.com/o/oauth2/v2/auth')
    expect(ui.notices[0]?.url).toContain('code_challenge_method=S256')
    expect(ui.notices[0]?.url).not.toContain('authorization-code-must-not-persist')
  })

  it('fails closed when Google reports only part of the configured consent', async () => {
    const ctx = await harness()
    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.resolve('code'),
      close: () => Promise.resolve(),
    })
    internals.fetch = (async () => new Response(JSON.stringify({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid email',
    }), { status: 200 })) as typeof fetch

    await expect(ctx.authorization.begin({ key: GOOGLE_ACCOUNT_KEY, interaction: surface().interaction }))
      .rejects.toMatchObject({ code: 'GOOGLE_SCOPE_PARTIAL' })
    expect(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)).toBeUndefined()
  })

  it('injects Bearer only at the Google fetch boundary and never returns it', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.resolve('code'),
      close: () => Promise.resolve(),
    })
    let calls = 0
    let apiAuthorization: string | null = null
    internals.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      if (calls === 1) {
        return new Response(JSON.stringify({
          access_token: 'boundary-only-access-token',
          refresh_token: 'boundary-only-refresh-token',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: SCOPES.join(' '),
        }), { status: 200 })
      }
      apiAuthorization = new Headers(init?.headers).get('authorization')
      return new Response(JSON.stringify({ messages: [{ id: 'm1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch

    await ctx.authorization.begin({ key: GOOGLE_ACCOUNT_KEY, interaction: surface().interaction })
    const result = await ctx.googleApi.request({
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.modify'],
    })

    expect(apiAuthorization).toBe('Bearer boundary-only-access-token')
    expect(result).toEqual({
      status: 200,
      ok: true,
      contentType: 'application/json',
      body: JSON.stringify({ messages: [{ id: 'm1' }] }),
    })
    expect(JSON.stringify(result)).not.toContain('boundary-only-access-token')
    expect(JSON.stringify(result)).not.toContain('boundary-only-refresh-token')
  })

  it('rejects caller credentials and OAuth endpoints before credentials can cross a caller-controlled path', async () => {
    const ctx = await harness()

    await expect(ctx.googleApi.request({
      url: 'https://oauth2.googleapis.com/token',
      requiredScopes: [],
    })).rejects.toMatchObject({ code: 'GOOGLE_DESTINATION_DENIED' })

    await expect(ctx.googleApi.request({
      url: 'https://www.googleapis.com/drive/v3/files',
      requiredScopes: [],
      headers: { Authorization: 'Bearer model-supplied-token' },
    })).rejects.toMatchObject({ code: 'GOOGLE_HEADER_DENIED' })
  })

  it('denies an API operation whose required scope was never granted', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.resolve('code'),
      close: () => Promise.resolve(),
    })
    internals.fetch = (async () => new Response(JSON.stringify({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: SCOPES.join(' '),
    }), { status: 200 })) as typeof fetch

    await ctx.authorization.begin({ key: GOOGLE_ACCOUNT_KEY, interaction: surface().interaction })

    await expect(ctx.googleApi.request({
      url: 'https://www.googleapis.com/drive/v3/files',
      requiredScopes: ['https://www.googleapis.com/auth/drive'],
    })).rejects.toMatchObject({ code: 'GOOGLE_SCOPE_DENIED' })
  })

  it('disconnects locally even when provider revocation fails', async () => {
    const ctx = await harness()
    internals.now = () => 1_000_000
    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.resolve('code'),
      close: () => Promise.resolve(),
    })
    let calls = 0
    internals.fetch = (async () => {
      calls += 1
      if (calls === 1) {
        return new Response(JSON.stringify({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: SCOPES.join(' '),
        }), { status: 200 })
      }
      throw new Error('provider unavailable')
    }) as typeof fetch

    await ctx.authorization.begin({ key: GOOGLE_ACCOUNT_KEY, interaction: surface().interaction })
    expect(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)).toEqual({ kind: 'api-key' })

    await expect(ctx.googleApi.disconnect()).resolves.toEqual({ revoked: false })
    expect(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)).toBeUndefined()
    await expect(ctx.googleApi.request({
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.modify'],
    })).rejects.toMatchObject({ code: 'GOOGLE_REAUTH_REQUIRED' })
  })
})
