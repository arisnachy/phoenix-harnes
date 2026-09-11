import { describe, expect, it } from 'vitest'
import { internals } from '@phoenix-ai/dsh-authorization/google'

describe('Google Desktop OAuth loopback compatibility', () => {
  it('uses the authority root as the redirect URI', async () => {
    const controller = new AbortController()
    const receiver = await internals.openLoopback('expected-state', controller.signal)
    try {
      const redirect = new URL(receiver.redirectUri)
      expect(redirect.hostname).toBe('127.0.0.1')
      expect(redirect.pathname).toBe('/')
      expect(redirect.search).toBe('')
      expect(redirect.hash).toBe('')
    } finally {
      await receiver.close()
    }
  })
})
