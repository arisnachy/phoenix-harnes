/** Provider ordering shared by the host catalog and browser model selectors. */

import type { ModelProviderGroup } from './api/index.ts'

/** User-profile service projection needed by the optional ordering preference. */
interface ProviderOrderSource {
  get(): { profile: { modelProviderOrder?: readonly string[] } }
}

/** Read a valid, unique provider order without making it a routing whitelist.
 * @param source - optional user-profile service projection.
 * @returns unique non-empty provider route ids.
 */
export function readProviderOrder(source: ProviderOrderSource | undefined): string[] {
  const order = source?.get().profile.modelProviderOrder
  if (order === undefined) return []
  return [...new Set(order.filter(provider => typeof provider === 'string' && provider.trim() !== ''))]
}

/**
 * Sort advisory provider groups by user preference and keep new providers
 * visible after the preferred entries. With no preference, native Codex comes first.
 * The preference never removes routes or changes the selected model.
 * @param groups - Provider groups returned by registered adapters.
 * @param providerOrder - Optional user-selected route order.
 * @returns A detached ordered group list.
 */
export function orderModelProviderGroups(
  groups: readonly ModelProviderGroup[],
  providerOrder: readonly string[],
): ModelProviderGroup[] {
  const effectiveOrder = providerOrder.length === 0 ? ['openai-codex'] : providerOrder
  const rank = new Map(effectiveOrder.map((provider, index) => [provider, index]))
  return groups
    .map((group, index) => ({ group, index }))
    .sort((left, right) => (rank.get(left.group.id) ?? effectiveOrder.length + left.index)
      - (rank.get(right.group.id) ?? effectiveOrder.length + right.index))
    .map(({ group }) => group.id === 'openai-codex' && group.name === group.id ? { ...group, name: 'OpenAI Codex' } : group)
}
