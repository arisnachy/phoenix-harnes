/** Immutable identity policy and selectors; no secrets or browser access. */
export type LoginProfile = 'personal' | 'kira'
/** Supported site-specific credential form profiles. */
export const LOGIN_PROFILES = ['personal', 'kira'] as const
/** Field requirements and identity for a supported login form. */
export interface LoginProfileInfo {
  id: LoginProfile
  saved: boolean
  automatic: boolean
  source: 'dpapi' | 'legacy-vault' | 'none'
}
/** Resolve the login form profile for a site.
 * @param value - Value to normalize or classify.
 * @returns The result produced by this operation.
 */
export function loginProfile(value: unknown): LoginProfile {
  if (value === 'personal' || value === 'kira') return value
  throw new TypeError('Perfil de acceso no válido')
}
/** Choose the preferred configured login form profile.
 * @param profiles - Profiles supplied to this operation.
 * @param preferred - Preferred supplied to this operation.
 * @returns The result produced by this operation.
 */
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
/** Determine whether an account can be provisioned for the requested site.
 * @param origin - Credential or workflow origin to inspect.
 * @param authorized - Authorized supplied to this operation.
 * @param supportedAdapter - Supported adapter supplied to this operation.
 * @returns The result produced by this operation.
 */
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
