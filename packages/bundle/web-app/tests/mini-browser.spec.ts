import { afterEach, describe, expect, it } from 'vitest'
import { miniBrowserRequestAllowed, normalizeMiniBrowserAddress } from '../src/mini-browser.ts'
import { browserVaultSupported, hasSecureBrowserLogin, saveSecureBrowserLogin, resolveSecureBrowserLogin, forgetSecureBrowserLogin, secureBrowserOrigin } from '../src/mini-browser-vault.ts'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

afterEach(() => { /* Pure contracts: no live Chrome or network is required. */ })

describe('Protected MiniBrowser vault contract', () => {
  it('binds logins to HTTPS origin and refuses URL embedded credentials', () => {
    expect(secureBrowserOrigin('https://Brand.Example/login?token=personal')).toBe('https://brand.example')
    expect(secureBrowserOrigin('http://127.0.0.1:3080/login')).toBe('http://127.0.0.1:3080')
    expect(() => secureBrowserOrigin('https://user:password@example.org')).toThrow()
    expect(() => secureBrowserOrigin('http://example.org/login')).toThrow()
    expect(() => secureBrowserOrigin('file:///C:/passwords')).toThrow()
  })
  it('round trips only encrypted DPAPI bytes across restarts on Windows', async () => {
    if (process.platform !== 'win32') return
    const root = mkdtempSync(join(tmpdir(), 'phoenix-vault-native-ci-'))
    const previous = process.env.LOCALAPPDATA
    process.env.LOCALAPPDATA = root
    try {
      const origin = 'https://survey.example'
      await saveSecureBrowserLogin(origin, 'private-user', 'private-password')
      expect(hasSecureBrowserLogin(origin)).toBe(true)
      expect(hasSecureBrowserLogin('https://other.example')).toBe(false)
      expect(await resolveSecureBrowserLogin(origin)).toEqual({
        account: 'private-user', secret: 'private-password',
      })
      const dir = join(root, 'Phoenix', 'browser-vault')
      const ciphertext = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8')
      expect(ciphertext).not.toContain('private-user')
      expect(ciphertext).not.toContain('private-password')
      expect(ciphertext).toContain('dpapi-current-user:v1:')
      await forgetSecureBrowserLogin(origin)
      expect(hasSecureBrowserLogin(origin)).toBe(false)
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, 'LOCALAPPDATA')
      else process.env.LOCALAPPDATA = previous
      rmSync(root, { recursive: true, force: true })
    }
  })
  it('fails closed without Windows DPAPI instead of writing plaintext fallbacks', () => {
    if (process.platform !== 'win32') {
      expect(browserVaultSupported()).toBe(false)
      expect(hasSecureBrowserLogin('https://survey.example')).toBe(false)
    }
  })
})

describe('MiniBrowser origin and navigation contracts', () => {
  const allowed = {
    remoteAddress: '127.0.0.1',
    host: '127.0.0.1:3080',
    origin: 'http://127.0.0.1:3080',
    marker: '1',
    fetchSite: 'same-origin',
  }
  it('accepts only a deliberate, same-origin loopback browser request', () => {
    expect(miniBrowserRequestAllowed(allowed)).toBe(true)
    expect(miniBrowserRequestAllowed({ ...allowed, remoteAddress: '::ffff:127.0.0.1' })).toBe(true)
    expect(miniBrowserRequestAllowed({ ...allowed, marker: undefined })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, remoteAddress: '10.0.0.3' })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, host: 'evil.example:3080' })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, origin: 'https://evil.example' })).toBe(false)
    expect(miniBrowserRequestAllowed({ ...allowed, fetchSite: 'cross-site' })).toBe(false)
  })
  it('converts hostnames and searches but refuses executable schemes and credential URLs', () => {
    expect(normalizeMiniBrowserAddress('youtube.com')).toBe('https://youtube.com/')
    expect(normalizeMiniBrowserAddress('http://127.0.0.1:3080/test')).toBe('http://127.0.0.1:3080/test')
    expect(normalizeMiniBrowserAddress('Bob Esponja')).toContain('https://www.google.com/search?q=Bob%20Esponja')
    expect(() => normalizeMiniBrowserAddress('https://user:password@example.org')).toThrow('HTTP(S)')
    expect(() => normalizeMiniBrowserAddress('')).toThrow()
    expect(() => normalizeMiniBrowserAddress('http://')).toThrow()
  })
})
