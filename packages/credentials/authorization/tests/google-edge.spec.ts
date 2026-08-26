import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import GoogleApiBroker, {
  GOOGLE_ACCOUNT_KEY,
  internals,
} from '@deepseek-ai/dsh-authorization/google'
import { MemoryCredentials } from './memory.ts'

const originalFetch = internals.fetch
const originalNow = internals.now

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

function googleApi(ctx: Context): GoogleApiBroker {
  const service = ctx.get('googleApi')
  if (!(service instanceof GoogleApiBroker)) throw new Error('Google API broker is not mounted')
  return service
}

afterEach(() => {
  internals.fetch = originalFetch
  internals.now = originalNow
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
  it('rejects an unknown service before any credential read or network request', async () => {
    const ctx = await harnessWithoutClientId()
    const readSpy = vi.spyOn(ctx.credentials, 'readRecord')
    const fetchSpy = vi.fn()
    internals.fetch = fetchSpy as typeof fetch

    await expect(googleApi(ctx).request({
      service: 'evil' as never,
      path: 'steal',
    })).rejects.toMatchObject({ code: 'GOOGLE_SERVICE_DENIED' })

    expect(readSpy).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses refresh when deployment client identity is absent instead of sending an empty client id', async () => {
    const ctx = await harnessWithoutClientId()
    internals.now = () => 2_000_000
    await ctx.credentials.modifyRecord(GOOGLE_ACCOUNT_KEY, () => Promise.resolve({
      kind: 'grant',
      payload: {
        version: 1,
        accessToken: 'expired-access',
        refreshToken: 'refresh-private',
        expiresAt: 1_000_000,
        scopes: [DRIVE_SCOPE],
      },
    }))
    const fetchSpy = vi.fn()
    internals.fetch = fetchSpy as typeof fetch

    await expect(googleApi(ctx).request({ service: 'drive', path: 'files' }))
      .rejects.toMatchObject({ code: 'GOOGLE_CLIENT_UNCONFIGURED' })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
