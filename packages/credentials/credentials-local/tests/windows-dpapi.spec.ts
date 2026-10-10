import { describe, expect, it } from 'vitest'
import {
  isProtectedWebLoginRef, protectWebLoginAtRest,
  unprotectWebLoginAtRest, webLoginNeedsProtection,
} from '../src/windows-dpapi.ts'

const account = 'PHOENIX_WEB_68747470733A2F2F6578616D706C652E636F6D_ACCOUNT'
const secret = 'PHOENIX_WEB_68747470733A2F2F6578616D706C652E636F6D_SECRET'

describe('Windows origin-scoped login encryption', () => {
  it('selects only website account and password refs, never ordinary provider keys', () => {
    expect(isProtectedWebLoginRef(account)).toBe(true)
    expect(isProtectedWebLoginRef(secret)).toBe(true)
    expect(isProtectedWebLoginRef('OPENAI_API_KEY')).toBe(false)
    expect(isProtectedWebLoginRef('PHOENIX_WEB_TRICK_SECRET')).toBe(false)
  })

  it('keeps non-web refs untouched while recognizing Windows legacy plaintext', async () => {
    expect(await protectWebLoginAtRest('OPENAI_API_KEY', 'some token')).toBe('some token')
    expect(webLoginNeedsProtection(secret, 'legacy pass')).toBe(process.platform === 'win32')
  })

  it('protects website logins for the current Windows user without changing a byte of the secret', async () => {
    if (process.platform !== 'win32') return
    const original = 'test login with an accented á and trailing spaces  '
    const protectedValue = await protectWebLoginAtRest(secret, original)
    expect(protectedValue).toMatch(/^win-dpapi-v1:[A-Za-z0-9+/=]+$/u)
    expect(protectedValue).not.toContain(original)
    expect(webLoginNeedsProtection(secret, protectedValue)).toBe(false)
    expect(await unprotectWebLoginAtRest(secret, protectedValue)).toBe(original)
    expect(await unprotectWebLoginAtRest(account,
      await protectWebLoginAtRest(account, 'demo@valid.example'))).toBe('demo@valid.example')
    await expect(unprotectWebLoginAtRest(secret, 'win-dpapi-v1:INVALID!')).rejects.toThrow(/protection/i)
  })
})
