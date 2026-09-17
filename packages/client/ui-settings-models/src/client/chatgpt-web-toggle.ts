/** Reconcile the ChatGPT Web process switch with its llm-pi-ai provider profile. */
import type { ChatGptWebSnapshot, IApiClient } from '@phoenix-ai/dsh-api-remotes/client'

/** Browser-safe Host lifecycle surface used by Settings. */
export interface ChatGptWebBridgeClient {
  state(): Promise<ChatGptWebSnapshot>
  enable(): Promise<ChatGptWebSnapshot>
  disable(): Promise<ChatGptWebSnapshot>
}

/** Settings mutation surface required by the switch. */
export type ChatGptWebSettingsClient = Pick<IApiClient['settings'], 'mutate'>

function requireMutation(response: Awaited<ReturnType<ChatGptWebSettingsClient['mutate']>>): void {
  if (!response.result.ok) throw new Error(response.result.error.message)
}

/**
 * Change the ChatGPT Web switch without exposing an unhealthy model route.
 * @param dependencies - Host bridge lifecycle and settings writer.
 * @param enabled - Desired switch state.
 * @returns Sanitized Host bridge state after reconciliation.
 */
export async function setChatGptWebEnabled(
  dependencies: {
    bridge: Pick<ChatGptWebBridgeClient, 'enable' | 'disable'>
    settings: ChatGptWebSettingsClient
  },
  enabled: boolean,
): Promise<ChatGptWebSnapshot> {
  if (enabled) {
    const snapshot = await dependencies.bridge.enable()
    if (snapshot.phase !== 'ready') return snapshot
    try {
      const response = await dependencies.settings.mutate({
        ns: 'llm-pi-ai',
        ops: [{ op: 'set', path: ['providers', 'chatgpt-web'], value: {} }],
      })
      requireMutation(response)
      return snapshot
    } catch (error) {
      await dependencies.bridge.disable()
      throw error
    }
  }

  const response = await dependencies.settings.mutate({
    ns: 'llm-pi-ai',
    ops: [{ op: 'unset', path: ['providers', 'chatgpt-web'] }],
  })
  requireMutation(response)
  return dependencies.bridge.disable()
}
