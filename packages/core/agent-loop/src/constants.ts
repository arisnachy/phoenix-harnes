/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10

/** Default maximum model/tool iterations in one user turn. */
export const DEFAULT_MAX_STEPS_PER_TURN = 64

/** Bound output-limit continuations for one human request. */
export const DEFAULT_AUTO_CONTINUE_MAX_SEGMENTS = 3

/** Routes whose short output budgets benefit from automatic continuation. */
export const DEFAULT_AUTO_CONTINUE_PROVIDERS = ['openrouter', 'deepseek', 'qwen'] as const
