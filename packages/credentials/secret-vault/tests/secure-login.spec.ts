import { describe, expect, it } from 'vitest'
import { loginOrigin, registerSecureLogin } from '../src/secure-login.ts'

describe('origin-scoped secure login', () => {
  it('canonicalizes full HTTPS URLs without crossing origins', () => {
    expect(loginOrigin('https://example.org/login?token=hidden')).toBe('https://example.org')
    expect(loginOrigin('https://example.org:8443/login')).toBe('https://example.org:8443')
    expect(loginOrigin('http://localhost:3080/login')).toBe('http://localhost:3080')
    expect(() => loginOrigin('http://example.org/login')).toThrow()
    expect(() => loginOrigin('https://user:password@example.org/login')).toThrow()
    expect(() => loginOrigin('file:///tmp/login')).toThrow()
  })

  it('rejects non-loopback requests before even accessing the vault', async () => {
    let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined
    const webServer = {
      register: (route: { path: string; handler: typeof handler }) => {
        expect(route.path).toBe('/phoenix-secure-login')
        handler = route.handler
        return () => {}
      },
    }
    registerSecureLogin({ webServer } as never)
    expect(handler).toBeDefined()
    let code = 0
    let body = ''
    const res = {
      writeHead(status: number) { code = status },
      end(value: string) { body = value },
    }
    await handler?.({
      method: 'GET',
      url: '/phoenix-secure-login/status?origin=https%3A%2F%2Fexample.org',
      socket: { remoteAddress: '192.0.2.42' },
      headers: { host: '127.0.0.1:3080', 'x-phoenix-secure-login': '1' },
    }, res)
    expect(code).toBe(403)
    expect(body).not.toContain('password')
  })

  it('rejects cross-origin POST requests even from loopback', async () => {
    let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined
    const webServer = { register: (route: { handler: typeof handler }) => {
      handler = route.handler
      return () => {}
    } }
    registerSecureLogin({ webServer } as never)
    let status = 0
    await handler?.({
      method: 'POST',
      url: '/phoenix-secure-login/use',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { host: '127.0.0.1:3080', origin: 'https://evil.example',
        'x-phoenix-secure-login': '1' },
    }, {
      writeHead(value: number) { status = value },
      end() {},
    })
    expect(status).toBe(403)
  })
})
