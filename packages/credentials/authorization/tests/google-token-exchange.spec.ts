import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AuthorizationService from '@phoenix-ai/dsh-authorization'
import GoogleApiBroker, { GOOGLE_ACCOUNT_KEY, internals } from '@phoenix-ai/dsh-authorization/google'
import { MemoryCredentials } from './memory.ts'

const originalFetch = internals.fetch
const originalOpenLoopback = internals.openLoopback

const SCOPES = ['openid', 'email'] as const

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(GoogleApiBroker, { clientId: 'desktop.apps.googleusercontent.com', scopes: SCOPES })
  return ctx
}

afterEach(() => {
  internals.fetch = originalFetch
  internals.openLoopback = originalOpenLoopback
})

describe('Google token exchange diagnostics', () => {
  it('keeps the provider reason bounded without exposing OAuth secrets', async () => {
    const ctx = await harness()
    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152',
      code: Promise.resolve('authorization-code-private'),
      close: () => Promise.resolve(),
    })
    internals.fetch = async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'Bad Request',
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })

    const interaction = {
      notify() {},
      prompt: () => Promise.reject(new Error('unexpected prompt')),
    }

    const attempt = ctx.authorization.begin({ key: GOOGLE_ACCOUNT_KEY, interaction })
    await expect(attempt).rejects.toMatchObject({
      code: 'GOOGLE_TOKEN_EXCHANGE',
      message: expect.stringContaining('invalid_grant'),
    })
    await expect(attempt).rejects.not.toThrow(/authorization-code-private/)
  })
})
