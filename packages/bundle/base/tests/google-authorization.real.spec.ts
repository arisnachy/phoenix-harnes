import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { GOOGLE_ACCOUNT_KEY } from '@deepseek-ai/dsh-authorization/google'

const fixture = fileURLToPath(new URL('./fixtures/google-authorization.cordis.yml', import.meta.url))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Google authorization REAL composition', () => {
  it('boots the shipping providers through Loader and exposes only the user-facing authorization entry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-google-real-'))
    vi.stubEnv('PHOENIX_GOOGLE_REAL_CREDENTIALS_PATH', join(dir, '.credentials.yaml'))

    const ctx = await boot('dsh-google-real', fixture, undefined, undefined, import.meta.url)
    try {
      expect(ctx.authorization.list()).toEqual([{
        key: GOOGLE_ACCOUNT_KEY,
        label: 'Google Workspace',
        methods: [{ id: 'oauth', label: 'Sign in with Google' }],
        inFlight: false,
      }])
      expect(ctx.get('googleApi')).toBeDefined()

      const info = await ctx.credentials.describeRecord(GOOGLE_ACCOUNT_KEY)
      expect(info.configured).toBe(false)
      expect(JSON.stringify(ctx.authorization.list())).not.toMatch(/access[_-]?token|refresh[_-]?token|bearer/i)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
