/** Model-route policy shared by completion testers and judges. */

import type { Agent, AgentOptions } from '@phoenix-ai/dsh-agent'
import type { LlmRuntime } from '@phoenix-ai/dsh-llm'

const REASONING_RANK = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const

/**
 * Resolve the exact independent verifier model route.
 * The completion reviewer always uses the exact active provider/model selected
 * by the user. Codex execution may be handed to Luna by the parent runtime, but
 * review returns here to the selected Codex model. Non-Codex/API-key providers
 * remain on their selected route and are never silently moved into Codex.
 * @param input - parent route, optional model catalog, and cancellation signal.
 * @returns independent child options preserving the intended reviewer model policy.
 */
export async function resolveGoalJudgeAgentOptions(input: {
  readonly parent: Agent
  readonly llm?: Pick<LlmRuntime, 'resolveModelInfo'>
  readonly signal: AbortSignal
}): Promise<AgentOptions> {
  const { provider, model, reasoningEffort } = input.parent.options
  if (provider === undefined || model === undefined) return {}
  if (reasoningEffort !== undefined) return { provider, model, reasoningEffort }
  if (input.llm !== undefined) {
    try {
      const resolved = await input.llm.resolveModelInfo(provider, model, input.signal)
      const effort = resolved.reasoning?.efforts
        .map(candidate => candidate.id)
        .sort((left, right) => rankReasoningEffort(right) - rankReasoningEffort(left))[0]
      if (effort !== undefined) return { provider, model, reasoningEffort: effort }
    } catch {
      // Capability lookup is advisory. Preserve the exact selected route and
      // let the real adapter report any provider/model failure.
    }
  }
  return { provider, model }
}

function rankReasoningEffort(value: string): number {
  const rank = REASONING_RANK.indexOf(value as typeof REASONING_RANK[number])
  return rank === -1 ? -1 : rank
}
