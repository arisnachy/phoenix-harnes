import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AuthorizationService from '@phoenix-ai/dsh-authorization'
import GoogleApiBroker, {
  GOOGLE_ACCOUNT_KEY,
  GOOGLE_CLIENT_ID_REF,
  internals,
} from '@phoenix-ai/dsh-authorization/google'
import { MemoryCredentials } from './memory.ts'

const originalFetch = internals.fetch
const originalOpenLoopback = internals.openLoopback

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

function googleApi(ctx: Context): GoogleApiBroker {
  const service: unknown = ctx.get('googleApi')
  if (!(service instanceof GoogleApiBroker)) throw new Error('Google API broker is not mounted')
  return service
}

afterEach(() => {
  internals.fetch = originalFetch
  internals.openLoopback = originalOpenLoopback
  vi.restoreAllMocks()
})

async function harnessWithoutClientId(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(GoogleApiBroker, { scopes: [DRIVE_SCOPE] })
  return ctx
}

describe('Google Workspace runtime guards', () => {
  it('rejects an unknown service before any network request', async () => {
    const ctx = await harnessWithoutClientId()
    const fetchSpy = vi.fn()
    internals.fetch = fetchSpy as typeof fetch

    await expect(googleApi(ctx).request({
      service: 'evil' as never,
      path: 'steal',
    })).rejects.toMatchObject({ code: 'GOOGLE_SERVICE_DENIED' })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('collects and persists a Desktop client id on first authorization when deployment config is absent', async () => {
    const ctx = await harnessWithoutClientId()
    const prompt = vi.fn(() => Promise.resolve('desktop.apps.googleusercontent.com'))
    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.resolve('authorization-code'),
      close: () => Promise.resolve(),
    })
    internals.fetch = async () => new Response(JSON.stringify({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: DRIVE_SCOPE,
    }), { status: 200, headers: { 'content-type': 'application/json' } })

    await expect(ctx.authorization.begin({
      key: GOOGLE_ACCOUNT_KEY,
      interaction: {
        notify: () => {},
        prompt,
      },
    })).resolves.toEqual({ status: 'authorized' })

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'text',
      message: 'Google Desktop OAuth client ID',
    }))
    await expect(ctx.credentials.resolve(GOOGLE_CLIENT_ID_REF)).resolves.toMatchObject({
      value: 'desktop.apps.googleusercontent.com',
    })
    expect(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)).toEqual({ kind: 'api-key' })
  })

  it('never treats a durable marker as a reusable OAuth grant', async () => {
    const ctx = await harnessWithoutClientId()
    await ctx.credentials.modifyRecord(GOOGLE_ACCOUNT_KEY, () => Promise.resolve({ kind: 'api-key' }))
    const fetchSpy = vi.fn()
    internals.fetch = fetchSpy as typeof fetch

    await expect(googleApi(ctx).request({ service: 'drive', path: 'files' }))
      .rejects.toMatchObject({ code: 'GOOGLE_REAUTH_REQUIRED' })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('purges a secret-bearing durable grant left by the superseded Google broker', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(AuthorizationService)
    await ctx.credentials.modifyRecord(GOOGLE_ACCOUNT_KEY, () => Promise.resolve({
      kind: 'grant',
      payload: {
        version: 1,
        accessToken: 'legacy-access-must-be-deleted',
        refreshToken: 'legacy-refresh-must-be-deleted',
        expiresAt: 9_999_999,
        scopes: [DRIVE_SCOPE],
      },
    }))

    await ctx.plugin(GoogleApiBroker, {
      clientId: 'desktop.apps.googleusercontent.com',
      scopes: [DRIVE_SCOPE],
    })

    await expect(ctx.authorization.inspect(GOOGLE_ACCOUNT_KEY)).resolves.toBeUndefined()
    expect(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)).toBeUndefined()
  })
})
