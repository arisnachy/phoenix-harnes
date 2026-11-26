import type { ModelDirectoryState } from './directory.ts'

const PRIMARY = 'google-antigravity'
const LEGACY = 'google-account'

/** Both route IDs use the same native CLI. Collapse only these aliases, never
 * the separate Google API provider. Keep the stored Host selection intact. */
export function projectAntigravitySelector(state: ModelDirectoryState): ModelDirectoryState {
  const primary = state.groups.find(group => group.id === PRIMARY)
  const legacy = state.groups.find(group => group.id === LEGACY)
  if (primary === undefined || legacy === undefined) return state
  const models = new Map(primary.models.map(model => [model.id, model]))
  for (const model of legacy.models) {
    if (!models.has(model.id)) models.set(model.id, model)
  }
  return {
    ...state,
    // The projection is UI-only; older chats can still execute their old route.
    current: state.current?.provider === LEGACY && models.has(state.current.model)
      ? { ...state.current, provider: PRIMARY }
      : state.current,
    groups: state.groups.flatMap(group => group.id === LEGACY ? []
      : group.id === PRIMARY ? [{ ...primary, models: [...models.values()] }] : [group]),
  }
}
