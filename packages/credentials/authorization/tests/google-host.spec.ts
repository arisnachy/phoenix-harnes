import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AuthorizationService from '@phoenix-ai/dsh-authorization'
import GoogleApiBroker, {
  GOOGLE_ACCOUNT_KEY,
  internals,
  resolveGoogleOAuthClientId,
} from '@phoenix-ai/dsh-authorization/google'
import { MemoryCredentials } from './memory.ts'

const originalFetch = internals.fetch
const originalOpenLoopback = internals.openLoopback
const originalOpenAuthorizationUrl = internals.openAuthorizationUrl
const tempDirs: string[] = []

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'phoenix-google-oauth-'))
  tempDirs.push(dir)
  return join(dir, 'google-oauth-client.json')
}

afterEach(() => {
  internals.fetch = originalFetch
  internals.openLoopback = originalOpenLoopback
  internals.openAuthorizationUrl = originalOpenAuthorizationUrl
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

describe('Google OAuth host bootstrap', () => {
  it('prefers the existing local Desktop OAuth client over the configured fallback', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({
      installed: {
        client_id: 'local.apps.googleusercontent.com',
        client_secret: 'must-never-be-returned',
        redirect_uris: ['http://localhost'],
      },
    }))

    expect(resolveGoogleOAuthClientId('fallback.apps.googleusercontent.com', file))
      .toBe('local.apps.googleusercontent.com')
  })

  it('uses the configured fallback when the local OAuth client file is absent', () => {
    expect(resolveGoogleOAuthClientId('fallback.apps.googleusercontent.com', tempFile()))
      .toBe('fallback.apps.googleusercontent.com')
  })

  it('fails loud on a malformed existing local OAuth client without exposing file contents', () => {
    const file = tempFile()
    writeFileSync(file, '{"installed":{"client_secret":"SUPER-SECRET"}}')

    let error: unknown
    try {
      resolveGoogleOAuthClientId('fallback.apps.googleusercontent.com', file)
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(TypeError)
    expect(String(error)).toMatch(/local Google OAuth client/i)
    expect(String(error)).not.toContain('SUPER-SECRET')
  })

  it('opens the Google authorization URL once from the Host when authorization begins', async () => {
    const ctx = new Context()
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(AuthorizationService)
    await ctx.plugin(GoogleApiBroker, {
      clientId: 'desktop.apps.googleusercontent.com',
      scopes: ['openid'],
    })

    internals.openLoopback = async () => ({
      redirectUri: 'http://127.0.0.1:49152/oauth2/callback',
      code: Promise.resolve('authorization-code-private'),
      close: () => Promise.resolve(),
    })
    internals.fetch = (async () => new Response(JSON.stringify({
      access_token: 'access-token-private',
      refresh_token: 'refresh-token-private',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const opened: string[] = []
    internals.openAuthorizationUrl = async (url: string) => { opened.push(url) }
    const notices: Array<{ message: string; url?: string }> = []

    await expect(ctx.authorization.begin({
      key: GOOGLE_ACCOUNT_KEY,
      interaction: {
        notify(notice: { message: string; url?: string }) { notices.push(notice) },
        prompt: () => Promise.reject(new Error('Google OAuth must not request pasted secrets')),
      },
    })).resolves.toEqual({ status: 'authorized' })

    expect(opened).toHaveLength(1)
    const authorizationUrl = new URL(opened[0]!)
    expect(authorizationUrl.origin).toBe('https://accounts.google.com')
    expect(authorizationUrl.pathname).toBe('/o/oauth2/v2/auth')
    expect(authorizationUrl.searchParams.get('client_id')).toBe('desktop.apps.googleusercontent.com')
    expect(notices[0]?.url).toBe(opened[0])
  })
})
