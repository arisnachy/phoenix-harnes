/** Immutable identity policy and selectors; no secrets or browser access. */
export type LoginProfile = 'personal' | 'kira'
/** Available named login identities; adding one does not change the personal default. */
export const LOGIN_PROFILES = ['personal', 'kira'] as const
/** Read-only saved-login metadata, excluding credentials and secret values. */
export interface LoginProfileInfo {
  id: LoginProfile
  saved: boolean
  automatic: boolean
  source: 'dpapi' | 'legacy-vault' | 'none'
}
/** Validate a caller-supplied login identity without coercing unknown values.
 * @param value - Untrusted candidate profile identifier.
 * @returns A supported login identity or throws for an unsupported value.
 */
export function loginProfile(value: unknown): LoginProfile {
  if (value === 'personal' || value === 'kira') return value
  throw new TypeError('Perfil de acceso no válido')
}
/** Choose a saved identity, retaining the personal profile as the fallback.
 * @param profiles - Available identities and their saved-state metadata.
 * @param preferred - Explicitly requested identity, if present and saved.
 * @returns The preferred saved identity, or the personal-first fallback.
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
/** Enforce explicit consent and adapter support before account provisioning.
 * @param origin - Site origin used to detect restricted services.
 * @param authorized - Whether the user explicitly authorized account creation.
 * @param supportedAdapter - Whether a verified registration adapter is available.
 * @returns The eligibility verdict or a specific reason provisioning is blocked.
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
