/** Model-route policy shared by completion testers and judges. */

import type { Agent, AgentOptions } from '@phoenix-ai/dsh-agent'
import type { LlmRuntime } from '@phoenix-ai/dsh-llm'

const REASONING_RANK = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const

/**
 * Resolve the exact independent verifier model route.
 * The reviewer always returns to the exact active parent provider/model. If the
 * parent selected a reasoning effort, preserve it. Otherwise use the highest
 * advertised effort when the catalog can resolve one. This keeps the Codex
 * cognitive default asymmetric: selected model plans/reviews while Luna Max is
 * used only for execution steps. Non-Codex providers are never rerouted.
 * @param input - parent route, optional model catalog, and cancellation signal.
 * @returns independent child options preserving the intended model policy.
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
