import { describe, expect, it } from 'vitest'
import { resolveGoogleOAuthClientId } from '@phoenix-ai/dsh-authorization/google'

function missingFile(): never {
  throw Object.assign(new Error('missing'), { code: 'ENOENT' })
}

describe('Google OAuth local client resolution', () => {
  it('prefers the existing KIRA/OpenClaw Desktop client file over config and environment', () => {
    const clientId = resolveGoogleOAuthClientId('config.apps.googleusercontent.com', {
      homeDir: '/home/phoenix',
      env: { PHOENIX_GOOGLE_OAUTH_CLIENT_ID: 'env.apps.googleusercontent.com' },
      readFile: (path) => {
        expect(path).toBe('/home/phoenix/.dsh/secrets/google-oauth-client.json')
        return JSON.stringify({
          installed: {
            client_id: 'local.apps.googleusercontent.com',
            client_secret: 'must-stay-host-only',
            redirect_uris: ['http://localhost'],
          },
        })
      },
    })

    expect(clientId).toBe('local.apps.googleusercontent.com')
  })

  it('falls back to explicit config and then PHOENIX_GOOGLE_OAUTH_CLIENT_ID when the local file is absent', () => {
    expect(resolveGoogleOAuthClientId('config.apps.googleusercontent.com', {
      homeDir: '/home/phoenix',
      env: { PHOENIX_GOOGLE_OAUTH_CLIENT_ID: 'env.apps.googleusercontent.com' },
      readFile: missingFile,
    })).toBe('config.apps.googleusercontent.com')

    expect(resolveGoogleOAuthClientId(undefined, {
      homeDir: '/home/phoenix',
      env: { PHOENIX_GOOGLE_OAUTH_CLIENT_ID: 'env.apps.googleusercontent.com' },
      readFile: missingFile,
    })).toBe('env.apps.googleusercontent.com')
  })

  it('accepts a migrated top-level client_id without ever returning the client_secret', () => {
    expect(resolveGoogleOAuthClientId(undefined, {
      homeDir: '/home/phoenix',
      env: {},
      readFile: () => JSON.stringify({
        client_id: 'migrated.apps.googleusercontent.com',
        client_secret: 'never-return-this',
      }),
    })).toBe('migrated.apps.googleusercontent.com')
  })

  it('fails loud but sanitized when a present local client file is malformed', () => {
    let error: unknown
    try {
      resolveGoogleOAuthClientId(undefined, {
        homeDir: '/home/phoenix',
        env: {},
        readFile: () => '{"installed":{"client_secret":"super-secret-value"}}',
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toContain('google-oauth-client.json')
    expect(String(error)).not.toContain('super-secret-value')
  })
})
