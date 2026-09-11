import { afterEach, describe, expect, it } from 'vitest'
import {
  googleOauthCompatInternals,
  internals,
} from '@phoenix-ai/dsh-authorization/google'

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const originalProviderFetch = googleOauthCompatInternals.fetch
const exchangeFetch = internals.fetch

function tokenResponse(): Response {
  return new Response(JSON.stringify({
    access_token: 'access-token-private',
    refresh_token: 'refresh-token-private',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'openid email profile',
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function exchangeBody(code: string, redirectUri: string): URLSearchParams {
  return new URLSearchParams({
    client_id: 'desktop.apps.googleusercontent.com',
    code,
    code_verifier: 'pkce-verifier',
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  })
}

afterEach(() => {
  googleOauthCompatInternals.fetch = originalProviderFetch
})

describe('Google OAuth verified browser completion', () => {
  it('does not tell the browser PHOENIX is connected until Google accepts the code exchange', async () => {
    const controller = new AbortController()
    const receiver = await internals.openLoopback('expected-state', controller.signal)
    const callback = new URL(receiver.redirectUri)
    callback.searchParams.set('state', 'expected-state')
    callback.searchParams.set('code', 'authorization-code-private')

    let browserSettled = false
    const browser = fetch(callback).then((response) => {
      browserSettled = true
      return response
    })
    await expect(receiver.code).resolves.toBe('authorization-code-private')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(browserSettled).toBe(false)

    googleOauthCompatInternals.fetch = async () => tokenResponse()
    await expect(exchangeFetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      body: exchangeBody('authorization-code-private', receiver.redirectUri),
    })).resolves.toMatchObject({ ok: true, status: 200 })

    const browserResponse = await browser
    expect(browserResponse.status).toBe(200)
    await expect(browserResponse.text()).resolves.toContain('PHOENIX is connected')
    await receiver.close()
  })

  it('surfaces the provider token-exchange reason instead of an opaque GOOGLE_TOKEN_EXCHANGE failure', async () => {
    const controller = new AbortController()
    const receiver = await internals.openLoopback('expected-state', controller.signal)
    const callback = new URL(receiver.redirectUri)
    callback.searchParams.set('state', 'expected-state')
    callback.searchParams.set('code', 'expired-code-private')

    const browser = fetch(callback)
    await expect(receiver.code).resolves.toBe('expired-code-private')
    googleOauthCompatInternals.fetch = async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'Bad Request: authorization code expired',
    }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })

    await expect(exchangeFetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      body: exchangeBody('expired-code-private', receiver.redirectUri),
    })).rejects.toMatchObject({
      code: 'GOOGLE_TOKEN_EXCHANGE',
      message: expect.stringContaining('invalid_grant'),
    })

    const browserResponse = await browser
    expect(browserResponse.status).toBe(400)
    const text = await browserResponse.text()
    expect(text).toContain('invalid_grant')
    expect(text).toContain('authorization code expired')
    await receiver.close()
  })
})
