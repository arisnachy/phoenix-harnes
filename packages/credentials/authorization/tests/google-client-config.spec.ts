import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveGoogleOAuthClientId } from '../src/google-client-config.ts'

const homes: string[] = []

function tempDshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'phoenix-google-oauth-'))
  homes.push(home)
  return home
}

function writeClient(home: string, value: unknown): void {
  const secrets = join(home, 'secrets')
  mkdirSync(secrets, { recursive: true })
  writeFileSync(join(secrets, 'google-oauth-client.json'), JSON.stringify(value), 'utf8')
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('Google OAuth client discovery', () => {
  it('prefers the local installed-app client id over the configured fallback', () => {
    const home = tempDshHome()
    writeClient(home, {
      installed: {
        client_id: 'local-desktop.apps.googleusercontent.com',
        client_secret: 'must-never-be-returned-or-logged',
        redirect_uris: ['http://localhost'],
      },
    })

    expect(resolveGoogleOAuthClientId('fallback.apps.googleusercontent.com', { dshHome: home }))
      .toBe('local-desktop.apps.googleusercontent.com')
  })

  it('falls back to the configured client id when the local file is absent', () => {
    const home = tempDshHome()

    expect(resolveGoogleOAuthClientId('fallback.apps.googleusercontent.com', { dshHome: home }))
      .toBe('fallback.apps.googleusercontent.com')
  })

  it('accepts the standard Google web-client JSON shape as a defensive fallback', () => {
    const home = tempDshHome()
    writeClient(home, { web: { client_id: 'local-web.apps.googleusercontent.com' } })

    expect(resolveGoogleOAuthClientId(undefined, { dshHome: home }))
      .toBe('local-web.apps.googleusercontent.com')
  })

  it('fails loud on a present malformed client file without leaking its contents', () => {
    const home = tempDshHome()
    const secrets = join(home, 'secrets')
    mkdirSync(secrets, { recursive: true })
    writeFileSync(
      join(secrets, 'google-oauth-client.json'),
      '{"installed":{"client_secret":"super-secret-material",',
      'utf8',
    )

    expect(() => resolveGoogleOAuthClientId('fallback.apps.googleusercontent.com', { dshHome: home }))
      .toThrowError(/failed to parse local Google OAuth client configuration/u)

    try {
      resolveGoogleOAuthClientId('fallback.apps.googleusercontent.com', { dshHome: home })
    } catch (error) {
      expect(String(error)).not.toContain('super-secret-material')
    }
  })

  it('fails loud when a present client file has no usable client id', () => {
    const home = tempDshHome()
    writeClient(home, { installed: { client_secret: 'do-not-log-me' } })

    expect(() => resolveGoogleOAuthClientId('fallback.apps.googleusercontent.com', { dshHome: home }))
      .toThrowError(/does not contain a usable client_id/u)
  })
})
