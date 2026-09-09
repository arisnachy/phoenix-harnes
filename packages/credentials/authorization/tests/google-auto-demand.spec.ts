import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AuthorizationService from '@phoenix-ai/dsh-authorization'
import GoogleApiBroker, { internals } from '@phoenix-ai/dsh-authorization/google'
import { MemoryCredentials } from './memory.ts'

const originalFetch = internals.fetch
const originalOpenLoopback = internals.openLoopback
const originalOpenBrowser = internals.openBrowser

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
const SCOPES = ['openid', 'email', GMAIL_SCOPE] as const

function googleApi(ctx: Context): GoogleApiBroker {
  const service: unknown = ctx.get('googleApi')
  if (!(service instanceof GoogleApiBroker)) throw new Error('Google API broker is not mounted')
  return service
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
  internals.openLoopback = originalOpenLoopback
  internals.openBrowser = originalOpenBrowser
  vi.restoreAllMocks()
})

describe('Google OAuth on first capability use', () => {
  it('automatically authorizes on the first Google API request and then completes that request', async () => {
    const ctx = await harness()
    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.resolve('authorization-code'),
      close: () => Promise.resolve(),
    })
    const opened: string[] = []
    internals.openBrowser = async (url: string) => { opened.push(url) }

    let calls = 0
    internals.fetch = (async (input: RequestInfo | URL) => {
      calls += 1
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({
          access_token: 'host-only-access',
          refresh_token: 'host-only-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: SCOPES.join(' '),
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1')
      return new Response('{"messages":[]}', { status: 200, headers: { 'content-type': 'application/json' } })
    })

    await expect(googleApi(ctx).request({ service: 'gmail', path: 'users/me/messages?maxResults=1' }))
      .resolves.toMatchObject({ status: 200, ok: true })

    expect(opened).toHaveLength(1)
    expect(calls).toBe(2)
  })

  it('does not repeatedly open authorization windows after an on-demand ceremony fails', async () => {
    const ctx = await harness()
    const opened: string[] = []
    internals.openBrowser = async (url: string) => { opened.push(url) }
    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.reject(new Error('user cancelled Google authorization')),
      close: () => Promise.resolve(),
    })

    await expect(googleApi(ctx).request({ service: 'gmail', path: 'users/me/messages' })).rejects.toThrow()
    await expect(googleApi(ctx).request({ service: 'gmail', path: 'users/me/messages' }))
      .rejects.toMatchObject({ code: 'GOOGLE_REAUTH_REQUIRED' })

    expect(opened).toHaveLength(1)
  })
})
