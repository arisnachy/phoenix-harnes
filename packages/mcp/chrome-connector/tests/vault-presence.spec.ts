import { describe, expect, it, vi } from 'vitest'
import { browserVaultHint, inspectVaultPresence } from '../src/vault-presence.ts'

describe('read-only model-safe Vault status tied to the inspected tab', () => {
  it('informs Kira about related saved credentials and never equates unknown with absent', () => {
    expect(browserVaultHint({ known: true, saved: false, automatic: false,
      relatedSaved: true, relatedOrigin: 'https://www.juancitosport.com.do' }))
      .toContain('NO afirmes que faltan credenciales')
    expect(browserVaultHint({ known: false, reason: 'vault-unavailable' }))
      .toContain('no afirmes que faltan credenciales')
    expect(browserVaultHint({ known: true, saved: true, automatic: true, relatedSaved: false }))
      .toContain('inicio automático')
  })

  it('reports an actual saved origin without exposing any account or password', async () => {
    const query = vi.fn(async (_url: string) => new Response(JSON.stringify({
      saved: true, automatic: false, source: 'dpapi',
      profile: 'personal', secret: 'NEVER_EXPOSE', account: 'HIDDEN',
    }), { status: 200 }))
    const result = await inspectVaultPresence('https://example.org/login', query as typeof fetch, '3080')
    expect(result).toEqual({ known: true, saved: true, automatic: false, relatedSaved: false })
    expect(JSON.stringify(result)).not.toContain('NEVER_EXPOSE')
    expect(query).toHaveBeenCalledWith(
      'http://127.0.0.1:3080/phoenix-secure-login/status?origin=https%3A%2F%2Fexample.org',
      expect.objectContaining({ headers: { 'x-phoenix-secure-login': '1' } }),
    )
  })
  it('makes related availability visible without silently promoting its permission', async () => {
    const query = vi.fn(async () => new Response(JSON.stringify({
      saved: false, automatic: false, relatedSaved: true,
      relatedOrigin: 'https://deportes.juancitosport.com.do',
    }), { status: 200 }))
    const result = await inspectVaultPresence('https://www.juancitosport.com.do/deportes',
      query as typeof fetch, '3080')
    expect(result).toEqual({ known: true, saved: false, automatic: false,
      relatedSaved: true, relatedOrigin: 'https://deportes.juancitosport.com.do' })
  })
  it('never confuses absent, unavailable and invalid page origins', async () => {
    const offline = vi.fn(async () => { throw new Error('Host offline') })
    expect(await inspectVaultPresence('https://example.org', offline as typeof fetch, '3080'))
      .toEqual({ known: false, reason: 'vault-unavailable' })
    expect(await inspectVaultPresence('about:blank', offline as typeof fetch, '3080'))
      .toEqual({ known: false, reason: 'no-web-origin' })
    expect(await inspectVaultPresence('https://example.org', offline as typeof fetch, 'not-a-port'))
      .toEqual({ known: false, reason: 'vault-unavailable' })
    expect(offline).toHaveBeenCalledTimes(1)
  })
})
