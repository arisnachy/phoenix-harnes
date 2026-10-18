/** Immutable identity policy and selectors; no secrets or browser access. */
export type LoginProfile = 'personal' | 'kira'
export const LOGIN_PROFILES = ['personal', 'kira'] as const
export interface LoginProfileInfo {
  id: LoginProfile
  saved: boolean
  automatic: boolean
  source: 'dpapi' | 'legacy-vault' | 'none'
}
export function loginProfile(value: unknown): LoginProfile {
  if (value === 'personal' || value === 'kira') return value
  throw new TypeError('Perfil de acceso no válido')
}
export function preferredLoginProfile(
  profiles: readonly LoginProfileInfo[], preferred?: LoginProfile,
): LoginProfile {
  // Existing personal credentials stay the default after adding Kira.
  if (preferred && profiles.some(p => p.id === preferred && p.saved)) return preferred
  if (profiles.some(p => p.id === 'personal' && p.saved)) return 'personal'
  if (profiles.some(p => p.id === 'kira' && p.saved)) return 'kira'
  return 'personal'
}
/** Account creation is a separate operation, never implied by timeout/no answer.
 * A future site adapter must prove registration capabilities before attempting
 * to create accounts. Restricted sectors are always ineligible for this flow.
 */
export type AccountProvisionDecision =
  | 'explicit-consent-required'
  | 'site-adapter-required'
  | 'restricted-service'
export function accountProvisionDecision(
  origin: string,
  authorized: boolean,
  supportedAdapter: boolean,
): AccountProvisionDecision | 'eligible' {
  const host = new URL(origin).hostname.toLowerCase()
  if (/(?:^|\.)(?:juancitosport\.com\.do|bet365\.com|stake\.com|binance\.com|coinbase\.com)$/.test(host)) {
    return 'restricted-service'
  }
  if (!authorized) return 'explicit-consent-required'
  return supportedAdapter ? 'eligible' : 'site-adapter-required'
}
