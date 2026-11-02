/** Internal Team delivery routing from the owning lead's current selection. */
import { defaultExecutionHandoff, latestModelSelectionPreference } from '@phoenix-ai/dsh-agent'
import type { Agent, ModelSelection } from '@phoenix-ai/dsh-agent'

/** Resolve the worker route at delivery, including durable changes to the lead's selection.
 * @param root - The owning Team lead.
 * @param target - Live child being resumed, when available. Children keep their
 * own durable route; only the legacy lead handoff uses the deployment default.
 * @returns The current execution route, or undefined when no route is configured.
 */
export function teamWorkerSelection(root: Agent, target: Agent = root): ModelSelection | undefined {
  const selected = latestModelSelectionPreference(target.session)?.selection
    ?? (target.options.provider === undefined || target.options.model === undefined ? undefined : {
      provider: target.options.provider,
      model: target.options.model,
      ...target.options.reasoningEffort === undefined ? {} : { reasoningEffort: target.options.reasoningEffort },
    })
  // A live child already carries the route selected when it was spawned. Do
  // not replace it with the lead's legacy Luna handoff on follow-up delivery.
  if (target !== root) return selected
  return defaultExecutionHandoff(selected)?.selection ?? selected
}
