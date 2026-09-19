/** Authorization-flow ↔ model-provider identity joins shared by onboarding and Models. */

/** Native Codex account flow: tokens stay owned by the Codex app-server. */
export const NATIVE_CODEX_AUTH_KEY = 'subagent-codex/account' as const
/** Main PHOENIX LLM route backed by the same native Codex account. */
export const NATIVE_CODEX_PROVIDER = 'openai-codex' as const

export interface AuthorizationProviderEntry {
  key: string
  stored?: { kind: string }
  telemetry?: { provider?: string }
}

/**
 * Map one authorization flow to the model provider it authenticates.
 * Most flows use <owner>/<provider>; the native Codex account intentionally
 * lives under the subagent package and therefore needs one explicit bridge.
 */
export function providerForAuthorization(entry: Pick<AuthorizationProviderEntry, 'key'>): string {
  if (entry.key === NATIVE_CODEX_AUTH_KEY) return NATIVE_CODEX_PROVIDER
  const slash = entry.key.indexOf('/')
  return slash < 0 ? entry.key : entry.key.slice(slash + 1)
}

/**
 * Whether the authorization flow represents a connected account.
 * Generic OAuth flows store a grant. Native Codex stores only a secret-free
 * marker while the actual tokens remain inside Codex; live Codex telemetry is
 * also authoritative when that marker predates PHOENIX.
 */
export function authorizationConnected(entry: AuthorizationProviderEntry): boolean {
  if (entry.key === NATIVE_CODEX_AUTH_KEY) {
    return entry.stored !== undefined || entry.telemetry?.provider?.toLowerCase() === 'codex'
  }
  return entry.stored?.kind === 'grant'
}
