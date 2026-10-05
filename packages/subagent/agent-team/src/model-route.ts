/** Internal Team delivery routing from the owning lead's current selection. */
import { defaultExecutionHandoff, latestModelSelectionPreference } from '@phoenix-ai/dsh-agent'
import type { Agent, ModelSelection } from '@phoenix-ai/dsh-agent'

/** Resolve the worker route at delivery, including durable changes to the lead's selection.
 * @param root - The owning Team lead.
 * @returns The current execution route, or undefined when the lead has no configured selection.
 */
export function teamWorkerSelection(root: Agent): ModelSelection | undefined {
  const selected = latestModelSelectionPreference(root.session)?.selection
    ?? (root.options.provider === undefined || root.options.model === undefined ? undefined : {
      provider: root.options.provider,
      model: root.options.model,
      ...root.options.reasoningEffort === undefined ? {} : { reasoningEffort: root.options.reasoningEffort },
    })
  return defaultExecutionHandoff(selected)?.selection ?? selected
}
