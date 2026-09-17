import type { ModelProviderGroup, ModelSelection, SessionModels } from '@phoenix-ai/dsh-api-remotes/client'

/** Provider id reserved by the built-in Phoenix Local route. */
export const PHOENIX_LOCAL_PROVIDER = 'phoenix-local'

/** Minimal install state needed by model-selection surfaces. */
export interface PhoenixLocalInstallState {
  selectedModelId: string
  installedModelIds: readonly string[]
}

/**
 * Whether the selected Phoenix Local runtime model is actually installed.
 * @param state - Current Phoenix Local installation state, when available.
 * @returns Whether the selected model id is present in the installed model set.
 */
export function isPhoenixLocalInstalled(state: PhoenixLocalInstallState | undefined): boolean {
  return state !== undefined && state.installedModelIds.includes(state.selectedModelId)
}

/**
 * Project the Host model directory into a user-selectable directory.
 *
 * The LLM adapter keeps `phoenix-local` registered so its lightweight loopback
 * proxy can preserve on-demand startup. Registration alone must not make an
 * uninstalled multi-GB model selectable, so the UI catalog hides the route
 * until the selected local model is present. Failure to read Host install state
 * is fail-closed for this one local route and leaves every cloud route intact.
 * @param directory - Model directory reported by the Host.
 * @param state - Current Phoenix Local installation state, when available.
 * @returns A directory with Phoenix Local exposed only when its selected model is installed.
 */
export function projectPhoenixLocalAvailability(
  directory: Pick<SessionModels, 'current' | 'routable' | 'groups' | 'failures'>,
  state: PhoenixLocalInstallState | undefined,
): Pick<SessionModels, 'current' | 'routable' | 'groups' | 'failures'> {
  if (isPhoenixLocalInstalled(state)) return directory

  const groups: ModelProviderGroup[] = directory.groups.filter(group => group.id !== PHOENIX_LOCAL_PROVIDER)
  const currentIsLocal = directory.current.provider === PHOENIX_LOCAL_PROVIDER
  return {
    ...directory,
    groups,
    routable: currentIsLocal ? false : directory.routable,
  }
}

/**
 * Reject stale or direct local selections when the backing local model is absent.
 * @param selection - Requested model selection.
 * @param state - Current Phoenix Local installation state, when available.
 */
export function assertPhoenixLocalSelectable(
  selection: ModelSelection,
  state: PhoenixLocalInstallState | undefined,
): void {
  if (selection.provider !== PHOENIX_LOCAL_PROVIDER) return
  if (isPhoenixLocalInstalled(state)) return
  throw new Error('Install Phoenix Local in Settings → Models before selecting it.')
}
