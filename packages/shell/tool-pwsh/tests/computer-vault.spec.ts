import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import { computerOriginAuthorized, resolveComputerWebLogin } from '../src/computer.ts'

describe('Computer uses the selected Secure Ask identity', () => {
  it('resolves saved access through the vault seam using only the canonical origin', async () => {
    const ctx = new Context()
    const origins: string[] = []
    const dispose = ctx.on('credentials/web-login-resolve', async (origin) => {
      origins.push(origin)
      return { authorized: true, account: 'synthetic-user', secret: 'synthetic-password', extras: { tenant: 'demo' } }
    })
    try {
      await expect(resolveComputerWebLogin(ctx, 'https://example.com/login')).resolves.toEqual({
        account: 'synthetic-user', secret: 'synthetic-password', extras: { tenant: 'demo' },
      })
      expect(origins).toEqual(['https://example.com'])
    } finally { dispose() }
  })

  it('honors a saved identity that denies unattended use', async () => {
    const ctx = new Context()
    const disposeStatus = ctx.on('credentials/web-login-status', async () => ({ saved: true, automatic: false }))
    const disposeLogin = ctx.on('credentials/web-login-resolve', async () => ({ authorized: false }))
    try {
      await expect(computerOriginAuthorized(ctx, 'https://example.com')).resolves.toBe(false)
      await expect(resolveComputerWebLogin(ctx, 'https://example.com')).rejects.toThrow(/Secure Ask/)
    } finally { disposeStatus(); disposeLogin() }
  })

  it('preauthorizes only the origin with a saved automatic login', async () => {
    const ctx = new Context()
    const dispose = ctx.on('credentials/web-login-status', async origin => origin === 'https://example.com'
      ? { saved: true, automatic: true } : undefined)
    try {
      await expect(computerOriginAuthorized(ctx, 'https://example.com/login')).resolves.toBe(true)
      await expect(computerOriginAuthorized(ctx, 'https://other.example')).resolves.toBe(false)
    } finally { dispose() }
  })
})
