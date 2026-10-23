/**
 * Per-model recovery eligibility for pi-ai generic provider failures.
 * Codex and OpenAI routes keep their established error semantics.
 */

/** Stable retry code reserved for an unclassified pi-ai error on eligible routes. */
export const RECOVERABLE_PI_AI_ERROR_CODE = 'PI_AI_TRANSIENT_ERROR'

/**
 * Determine whether generic (otherwise unclassified) provider errors can
 * undergo the provider's configured bounded retry policy.
 * @param provider - Actual provider route key.
 * @param model - Actual selected model ID, empty when determining route defaults.
 * @returns True for eligible non-OpenAI/Codex model requests.
 */
export function isNonCodexRecoveryModel(provider: string, model: string): boolean {
  const route = provider.trim().toLowerCase()
  const selected = model.trim().toLowerCase()
  if (!route || /^(?:openai|openai-codex|chatgpt-web)$/.test(route) || route.includes('codex')) return false
  if (selected.startsWith('openai/') || selected.includes('codex')) return false
  return true
}
