import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AuthorizationService from '@phoenix-ai/dsh-authorization'
import GoogleApiBroker, { GOOGLE_ACCOUNT_KEY, internals } from '@phoenix-ai/dsh-authorization/google'
import { MemoryCredentials } from './memory.ts'

const originalFetch = internals.fetch
const originalOpenLoopback = internals.openLoopback
const originalOpenBrowser = internals.openBrowser

const SCOPES = ['openid', 'email'] as const

afterEach(() => {
  internals.fetch = originalFetch
  internals.openLoopback = originalOpenLoopback
  internals.openBrowser = originalOpenBrowser
  vi.restoreAllMocks()
})

describe('Google OAuth browser ceremony', () => {
  it('opens the generated Google authorization URL automatically exactly once', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(AuthorizationService)
    await ctx.plugin(GoogleApiBroker, { clientId: 'client.apps.googleusercontent.com', scopes: SCOPES })

    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.resolve('authorization-code'),
      close: () => Promise.resolve(),
    })
    internals.fetch = (async () => new Response(JSON.stringify({
      access_token: 'host-only-access',
      refresh_token: 'host-only-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: SCOPES.join(' '),
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const opened: string[] = []
    internals.openBrowser = async (url: string) => { opened.push(url) }
    const notices: Array<{ message: string; url?: string }> = []

    await expect(ctx.authorization.begin({
      key: GOOGLE_ACCOUNT_KEY,
      interaction: {
        notify(notice) { notices.push(notice) },
        prompt: () => Promise.reject(new Error('Google loopback OAuth must not prompt for secrets')),
      },
    })).resolves.toEqual({ status: 'authorized' })

    expect(opened).toHaveLength(1)
    expect(opened[0]).toContain('https://accounts.google.com/o/oauth2/v2/auth')
    expect(opened[0]).toContain('code_challenge_method=S256')
    expect(notices).toHaveLength(1)
    expect(notices[0]?.url).toBe(opened[0])
  })
})
