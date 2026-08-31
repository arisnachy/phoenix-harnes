import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AuthorizationService from '@phoenix-ai/dsh-authorization'
import GoogleApiBroker, { GOOGLE_ACCOUNT_KEY, internals } from '@phoenix-ai/dsh-authorization/google'
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

afterEach(() => {
  internals.fetch = originalFetch
  internals.now = originalNow
  internals.openLoopback = originalOpenLoopback
})

async function authorizedGoogle(grantedScopes: readonly string[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(GoogleApiBroker, { clientId: 'client.apps.googleusercontent.com', scopes: SCOPES })

  internals.now = () => 1_000_000
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
    scope: grantedScopes.join(' '),
  }), { status: 200, headers: { 'content-type': 'application/json' } }))

  await ctx.authorization.begin({
    key: GOOGLE_ACCOUNT_KEY,
    interaction: {
      notify: () => {},
      prompt: () => Promise.reject(new Error('Google OAuth must remain browser-only')),
    },
  })
  return ctx
}

describe('Google Workspace account telemetry', () => {
  it('projects the seven fixed Workspace services and the exact granted capabilities', async () => {
    const ctx = await authorizedGoogle([
      'openid',
      'email',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar',
    ])

    const telemetry = await ctx.authorization.inspect(GOOGLE_ACCOUNT_KEY)
    expect(telemetry).toMatchObject({
      kind: 'account',
      provider: 'Google Workspace',
      accountType: 'oauth',
    })
    if (telemetry?.kind !== 'account') throw new Error('expected account telemetry')
    expect(telemetry.connectors).toHaveLength(7)

    const gmail = telemetry.connectors?.find(service => service.id === 'gmail')
    const calendar = telemetry.connectors?.find(service => service.id === 'calendar')
    const drive = telemetry.connectors?.find(service => service.id === 'drive')
    expect(gmail).toMatchObject({ name: 'Gmail', installed: true, callable: true, accessible: true, enabled: true })
    expect(calendar).toMatchObject({ name: 'Google Calendar', installed: true, callable: true })
    expect(drive).toMatchObject({ name: 'Google Drive', installed: false, callable: false })

    expect(JSON.stringify(telemetry)).not.toMatch(/access-token-private|refresh-token-private|authorization-code-private/)
  })
})
