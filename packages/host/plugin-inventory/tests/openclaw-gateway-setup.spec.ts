import { describe, expect, it } from 'vitest'
import { parseOpenClawDashboard } from '../src/openclaw-gateway-setup.ts'

const valid = {
  url: 'http://127.0.0.1:18789/?token=operator-private-12345',
  browserUrl: 'http://127.0.0.1:18789/#bootstrap=one-time-private-link',
  port: 18789,
}
describe('OpenClaw local Gateway pairing', () => {
  it('keeps the Gateway token separate from the browser pairing URL', () => {
    const value = parseOpenClawDashboard(valid)
    expect(value.token).toBe('operator-private-12345')
    expect(value.authorizationUrl).not.toContain(value.token)
    expect(value.port).toBe(18789)
  })
  it('rejects nonlocal, mismatched, and missing-token links', () => {
    expect(() => parseOpenClawDashboard({ ...valid,
      browserUrl: 'https://evil.example/#bootstrap=stolen' })).toThrow('trusted local')
    expect(() => parseOpenClawDashboard({ ...valid, port: 18888 })).toThrow('trusted local')
    expect(() => parseOpenClawDashboard({ ...valid,
      browserUrl: valid.url + '#bootstrap=one-time-private-link' })).toThrow('expired')
    expect(() => parseOpenClawDashboard({ ...valid,
      url: 'http://127.0.0.1:18789/' })).toThrow('not available')
  })
})
