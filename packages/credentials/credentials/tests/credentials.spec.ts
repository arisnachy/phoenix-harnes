import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import { credentialRef, isCredentialKeySegment, normalizeCredentialOrigin, originCredentialRef } from '../src/index.ts'
import type { CredentialRef } from '../src/index.ts'
import { MemoryCredentials } from './memory.ts'

const REF = credentialRef('DEEPSEEK_API_KEY')

async function boot(seed: Record<string, string> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials, seed)
  return ctx
}

describe('credentialRef', () => {
  it('brands POSIX shell identifiers', () => {
    expect(credentialRef('DEEPSEEK_API_KEY')).toBe('DEEPSEEK_API_KEY')
    expect(credentialRef('_private')).toBe('_private')
    expect(credentialRef('lower_case9')).toBe('lower_case9')
  })

  it('rejects every other shape', () => {
    for (const invalid of ['', '9LEADING', 'WITH-DASH', 'WITH SPACE', 'ns:key']) {
      expect(() => credentialRef(invalid)).toThrow(TypeError)
    }
  })
})

describe('origin-bound web credentials', () => {
  it('canonicalizes secure remote origins and loopback HTTP only', () => {
    expect(normalizeCredentialOrigin('https://Example.com/login?next=1')).toBe('https://example.com')
    expect(normalizeCredentialOrigin('http://localhost:3080/sign-in')).toBe('http://localhost:3080')
    expect(normalizeCredentialOrigin('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080')
    expect(() => normalizeCredentialOrigin('http://example.com/login')).toThrow(/HTTPS/)
    expect(() => normalizeCredentialOrigin('file:///tmp/secret')).toThrow(/HTTPS/)
    expect(() => normalizeCredentialOrigin('https://embedded-user@example.com')).toThrow(/user information/)
  })

  it('derives collision-free environment-shaped references', () => {
    const secretRef = originCredentialRef('https://example.com/login', 'secret')
    const accountRef = originCredentialRef('https://example.com', 'account')
    expect(secretRef).toMatch(/^PHOENIX_WEB_[0-9A-F]+_SECRET$/)
    expect(accountRef).toMatch(/^PHOENIX_WEB_[0-9A-F]+_ACCOUNT$/)
    expect(secretRef).not.toContain('example.com')
    expect(secretRef).not.toBe(accountRef)
    expect(originCredentialRef('https://example.com/a', 'secret')).toBe(secretRef)
    expect(originCredentialRef('https://example.com:444/a', 'secret')).not.toBe(secretRef)
  })
})

describe('isCredentialKeySegment', () => {
  it('answers whether credentialKey would accept the segment', () => {
    for (const valid of ['llm-pi-ai', 'openai-codex', 'a', 'z9']) {
      expect(isCredentialKeySegment(valid)).toBe(true)
    }
    // The shapes an arbitrary settings dict key can take that a record id
    // cannot: a consumer asks here instead of learning it from a throw.
    for (const invalid of ['', 'My_Proxy', 'z.ai', 'UPPER', '9leading', 'a/b']) {
      expect(isCredentialKeySegment(invalid)).toBe(false)
    }
  })
})

describe('the credentials seam through the memory provider', () => {
  it('mounts as ctx.credentials and resolves a seeded reference with its source', async () => {
    const ctx = await boot({ DEEPSEEK_API_KEY: 'sk-seeded' })
    expect(await ctx.credentials.resolve(REF)).toEqual({ value: 'sk-seeded', source: 'memory' })
    expect(await ctx.credentials.describe(REF)).toEqual({ configured: true, source: 'memory', writable: true })
  })

  it('treats an empty stored value as absent everywhere', async () => {
    const ctx = await boot({ DEEPSEEK_API_KEY: '' })
    expect(await ctx.credentials.resolve(REF)).toBeUndefined()
    expect(await ctx.credentials.describe(REF)).toEqual({ configured: false, writable: true })
  })

  it('stores through set, removes through unset, and emits the committed change', async () => {
    const ctx = await boot()
    const events: CredentialRef[] = []
    ctx.on('credentials/reference-updated', ref => void events.push(ref))

    await ctx.credentials.set(REF, 'sk-live')
    expect(await ctx.credentials.resolve(REF)).toEqual({ value: 'sk-live', source: 'memory' })
    await ctx.credentials.unset(REF)
    expect(await ctx.credentials.resolve(REF)).toBeUndefined()
    expect(events).toEqual([REF, REF])
  })

  it('rejects an empty set and keeps an absent unset silent', async () => {
    const ctx = await boot()
    const events: CredentialRef[] = []
    ctx.on('credentials/reference-updated', ref => void events.push(ref))

    await expect(ctx.credentials.set(REF, '')).rejects.toThrow(/empty value/)
    await ctx.credentials.unset(REF)
    expect(events).toEqual([])
  })

  it('removes the service with its fiber', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(MemoryCredentials)
    expect(ctx.get('credentials')).toBeDefined()
    await fiber.dispose()
    expect(ctx.get('credentials')).toBeUndefined()
  })
})
