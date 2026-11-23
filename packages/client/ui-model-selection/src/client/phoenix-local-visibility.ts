import type { ModelProviderGroup, ModelSelection, SessionModels } from '@phoenix-ai/dsh-api-remotes/client'

/** Stable wire route of the Host local runtime. */
export const PHOENIX_LOCAL_PROVIDER = 'phoenix-local'

/** Public inventory subset consumed by model-selection surfaces. */
export interface PhoenixLocalInstallState {
  selectedModelId: string
  installedModelIds: readonly string[]
  ollamaInstalledModelIds?: readonly string[]
  catalog?: readonly { id: string; displayName: string; backend: 'ollama' | 'llama-server' }[]
  thinking?: boolean | string | null
  thinkingCapabilities?: { readonly values: readonly (boolean | string)[]; readonly default: boolean | string | null }
  mode?: 'off' | 'on-demand' | 'always-on'
}

/** Encode native choices without sending them to the generic pi-ai effort API. */
export function localThinkingEffort(value: boolean | string | null | undefined): string | undefined {
  return value == null ? undefined : typeof value === 'boolean' ? (value ? 'on' : 'off') : value
}

export function projectLocalCurrent(selection: ModelSelection, state: PhoenixLocalInstallState): ModelSelection {
  const { reasoningEffort: _oldEffort, ...rest } = selection
  const effort = localThinkingEffort(state.thinking)
  const supported = state.thinkingCapabilities?.values.some(value => localThinkingEffort(value) === effort)
  return { ...rest, model: state.selectedModelId, ...(effort !== undefined && supported ? { reasoningEffort: effort } : {}) }
}

function installedCandidates(state: PhoenixLocalInstallState) {
  const linked = new Set(state.installedModelIds)
  const ollama = state.ollamaInstalledModelIds === undefined ? undefined : new Set(state.ollamaInstalledModelIds)
  return (state.catalog ?? []).filter(model => model.backend === 'ollama' && ollama !== undefined
    ? ollama.has(model.id)
    : linked.has(model.id))
}

/**
 * Check whether the current runtime model is installed and linked.
 * @param state - Host install state, when available.
 * @returns Whether the selected local artifact can be used.
 */
export function isPhoenixLocalInstalled(state: PhoenixLocalInstallState | undefined): boolean {
  return state !== undefined && state.mode !== 'off'
    && state.installedModelIds.includes(state.selectedModelId)
    && (state.catalog === undefined || installedCandidates(state).some(model => model.id === state.selectedModelId))
}

/**
 * Replace the generic route row with exact installed artifacts; the wire
 * route remains unchanged and local runtime selection remains Host-wide.
 * @param directory - Host model catalog.
 * @param state - Current local inventory.
 * @returns Directory with concrete local choices and active model.
 */
export function projectPhoenixLocalAvailability(
  directory: Pick<SessionModels, 'current' | 'routable' | 'groups' | 'failures'>,
  state: PhoenixLocalInstallState | undefined,
): Pick<SessionModels, 'current' | 'routable' | 'groups' | 'failures'> {
  const currentIsLocal = directory.current.provider === PHOENIX_LOCAL_PROVIDER
  const localReady = isPhoenixLocalInstalled(state)
  const groups: ModelProviderGroup[] = directory.groups.flatMap(group => {
    if (group.id !== PHOENIX_LOCAL_PROVIDER) return [group]
    if (state === undefined || state.mode === 'off') return []
    const name = group.name.replace(/^🔥\s*/u, '')
    if (state.catalog === undefined) return localReady ? [{ ...group, name }] : []
    const models = installedCandidates(state).map(model => ({
      id: model.id,
      name: model.displayName,
      description: model.backend === 'ollama' ? 'Ollama · Local' : 'GGUF · Local',
      ...(model.id === state.selectedModelId
        && state.thinkingCapabilities?.values.some(value => value !== false)
        ? { reasoning: { efforts: state.thinkingCapabilities.values.map(value => ({
            id: localThinkingEffort(value)!,
            name: value === false ? 'Sin pensar' : value === true ? 'Pensar' : value,
          })) } }
        : {}),
    }))
    return models.length === 0 ? [] : [{ ...group, name, models }]
  })
  return {
    ...directory,
    groups,
    current: currentIsLocal && localReady && state?.catalog !== undefined
      ? projectLocalCurrent(directory.current, state)
      : directory.current,
    routable: currentIsLocal ? directory.routable && localReady : directory.routable,
  }
}

/**
 * Reject stale or unavailable local artifacts; cloud selections are untouched.
 * @param selection - Requested selection.
 * @param state - Current Host inventory.
 */
export function assertPhoenixLocalSelectable(selection: ModelSelection, state: PhoenixLocalInstallState | undefined): void {
  if (selection.provider !== PHOENIX_LOCAL_PROVIDER) return
  if (selection.model === PHOENIX_LOCAL_PROVIDER && isPhoenixLocalInstalled(state)) return
  if (state !== undefined && state.mode !== 'off'
    && installedCandidates(state).some(model => model.id === selection.model)) return
  throw new Error('Install Phoenix Local in Settings → Models before selecting it.')
}
