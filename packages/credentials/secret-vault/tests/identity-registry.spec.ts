import { describe, expect, it } from 'vitest'
import {
  accountProvisionDecision, loginProfile, preferredLoginProfile, type LoginProfileInfo,
} from '../src/identity-registry.ts'

const profiles: LoginProfileInfo[] = [
  { id: 'personal', saved: true, automatic: true, source: 'legacy-vault' },
  { id: 'kira', saved: true, automatic: false, source: 'dpapi' },
]
describe('independent Phoenix website identities', () => {
  it('prefers existing personal credentials without deleting the Kira account', () => {
    expect(preferredLoginProfile(profiles)).toBe('personal')
    expect(preferredLoginProfile(profiles, 'kira')).toBe('kira')
    expect(preferredLoginProfile([
      { ...profiles[0]!, saved: false }, profiles[1]!,
    ])).toBe('kira')
    expect(profiles).toHaveLength(2)
  })
  it('never treats unknown identity selectors as valid', () => {
    expect(loginProfile('personal')).toBe('personal')
    expect(loginProfile('kira')).toBe('kira')
    expect(() => loginProfile('admin')).toThrow()
    expect(() => loginProfile(undefined)).toThrow()
  })
  it('never provisions an account because the user did not respond', () => {
    expect(accountProvisionDecision('https://example.org', false, true))
      .toBe('explicit-consent-required')
    expect(accountProvisionDecision('https://example.org', true, false))
      .toBe('site-adapter-required')
    expect(accountProvisionDecision('https://example.org', true, true))
      .toBe('eligible')
    expect(accountProvisionDecision('https://www.juancitosport.com.do', true, true))
      .toBe('restricted-service')
    expect(accountProvisionDecision('https://binance.com', true, true))
      .toBe('restricted-service')
  })
})
