import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, verify } from 'node:crypto'
import { PhoenixWebBotSigner, signerFromEnvironment } from '../src/web-bot-auth.ts'
import { parseRobots, robotsAllows } from '../src/robots.ts'

describe('PHOENIX free verified web identity', () => {
  const keys = generateKeyPairSync('ed25519')
  const privatePem = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  it('signs requests using unique RFC 9421 Ed25519 HTTP headers', () => {
    const signer = new PhoenixWebBotSigner('https://phoenix.example', privatePem)
    const url = new URL('https://example.org/article')
    const signed = signer.signRequest(url, 1762340400)
    const params = signed['signature-input'].slice('sig1='.length)
    const base = `"@authority": example.org\n"signature-agent": "https://phoenix.example"\n"@signature-params": ${params}`
    const bytes = Buffer.from(signed.signature.slice('sig1=:'.length, -1), 'base64')
    expect(verify(null, Buffer.from(base), keys.publicKey, bytes)).toBe(true)
    expect(params).toContain('tag="web-bot-auth"')
    expect(params).toContain(`keyid="${signer.keyId}"`)
    expect(signer.publicKeyDirectory().keys[0]?.x).toBe(signer.publicJwk.x)
    expect(signer.signRequest(url, 1762340400).signature).not.toBe(signed.signature)
  })

  it('refuses partial identity configuration and plain HTTP signing', () => {
    expect(signerFromEnvironment({})).toBeUndefined()
    expect(() => signerFromEnvironment({ PHOENIX_WEB_BOT_AUTH_AGENT_URL: 'https://phoenix.example' })).toThrow()
    expect(() => new PhoenixWebBotSigner('http://phoenix.example', privatePem)).toThrow()
    expect(() => new PhoenixWebBotSigner('https://phoenix.example', privatePem).signRequest(new URL('http://example.org')))
      .toThrow()
  })
})

describe('PHOENIX robots policy', () => {
  const policy = parseRobots(`
User-agent: *
Disallow: /secret
Crawl-delay: 1

User-agent: PHOENIX-ResearchBot
Disallow: /private
Allow: /private/public
Crawl-delay: 2
`)
  it('prefers PHOENIX rules to wildcard and longest allow to deny', () => {
    expect(robotsAllows(new URL('https://example.com/private/notes'), policy)).toBe(false)
    expect(robotsAllows(new URL('https://example.com/private/public/report'), policy)).toBe(true)
    expect(robotsAllows(new URL('https://example.com/secret'), policy)).toBe(true)
    expect(policy.crawlDelayMs).toBe(2000)
  })
  it('supports wildcards, terminal rules and empty Disallow', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /file*.pdf$\nAllow: /file-public.pdf$\nDisallow:')
    expect(robotsAllows(new URL('https://example.com/file-a.pdf'), rules)).toBe(false)
    expect(robotsAllows(new URL('https://example.com/file-a.pdf/preview'), rules)).toBe(true)
    expect(robotsAllows(new URL('https://example.com/other'), rules)).toBe(true)
  })
})
