/** Provider ordering shared by the host catalog and browser model selectors. */

import type { ModelProviderGroup } from './api/index.ts'

/** User-profile service projection needed by the optional ordering preference. */
interface ProviderOrderSource {
  get(): { profile: { modelProviderOrder?: readonly string[]; hiddenModelProviders?: readonly string[] } }
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

/** Read routes removed from the manual selector. */
export function readHiddenModelProviders(source: ProviderOrderSource | undefined): string[] {
  return [...new Set(source?.get().profile.hiddenModelProviders ?? [])]
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
  hiddenProviders: readonly string[] = [],
): ModelProviderGroup[] {
  const effectiveOrder = providerOrder.length === 0 ? ['openai-codex'] : providerOrder
  const rank = new Map(effectiveOrder.map((provider, index) => [provider, index]))
  const hidden = new Set([...hiddenProviders, 'chatgpt-web'])
  const unique = new Map<string, ModelProviderGroup>()
  for (const group of groups) {
    if (hidden.has(group.id)) continue
    const prior = unique.get(group.id)
    const models = new Map((prior?.models ?? []).map(model => [model.id, model]))
    for (const model of group.models) if (!models.has(model.id)) models.set(model.id, model)
    unique.set(group.id, { ...(prior ?? group), models: [...models.values()] })
  }
  const canonical = unique.get('google-antigravity')
  const seen = new Set<string>()
  const entries = [...unique.values()].filter(group => {
    if (!/antigravity/i.test(group.name) || !/cli/i.test(group.name)) return true
    const key = JSON.stringify(group.models.map(model => model.id).sort())
    if (canonical !== undefined && group.id !== canonical.id
      && key === JSON.stringify(canonical.models.map(model => model.id).sort())) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return entries
    .map((group, index) => ({ group, index }))
    .sort((left, right) => (rank.get(left.group.id) ?? effectiveOrder.length + left.index)
      - (rank.get(right.group.id) ?? effectiveOrder.length + right.index))
    .map(({ group }) => group.id === 'openai-codex' && group.name === group.id ? { ...group, name: 'OpenAI Codex' } : group)
}
