import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import GoogleApiBroker, {
  GOOGLE_ACCOUNT_KEY,
  internals,
} from '@deepseek-ai/dsh-authorization/google'
import { MemoryCredentials } from './memory.ts'

const originalFetch = internals.fetch

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

function googleApi(ctx: Context): GoogleApiBroker {
  const service = ctx.get('googleApi')
  if (!(service instanceof GoogleApiBroker)) throw new Error('Google API broker is not mounted')
  return service
}

afterEach(() => {
  internals.fetch = originalFetch
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

  it('refuses interactive authorization when the deployment client identity is absent', async () => {
    const ctx = await harnessWithoutClientId()
    const fetchSpy = vi.fn()
    internals.fetch = fetchSpy as typeof fetch

    await expect(ctx.authorization.begin({
      key: GOOGLE_ACCOUNT_KEY,
      interaction: {
        notify: () => {},
        prompt: () => Promise.reject(new Error('not used')),
      },
    })).rejects.toMatchObject({ code: 'GOOGLE_CLIENT_UNCONFIGURED' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(await ctx.credentials.readRecord(GOOGLE_ACCOUNT_KEY)).toBeUndefined()
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