/**
 * Cooperative tool-call timeout enforcer plus the default command-policy gate.
 * A tool declares `timeoutMs` and promises to honor `exec.signal`; this wrapper
 * arms that deadline and maps its own expiry to `TOOL_TIMEOUT` without racing
 * or abandoning the tool promise. The same already-mounted guard composes the
 * Codex-inspired ExecPolicy at `tools/pre-execute`, keeping bundle wiring small
 * and making command policy available in every PHOENIX profile.
 *
 * FIXME: settle the intended `@phoenix-ai/dsh-timeout-guard` rename before the
 * first tagged release — suggestion only, aligning the name with its `guard/`
 * home; decide at resolution time
 * ([regrouping Agent Note](../../../../.agents/notes/implemented/architecture/2026-07-29-package-regrouping.md)).
 *
 * @module @phoenix-ai/dsh-tool-call-timeout-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import { deadline, timeoutOf } from '@phoenix-ai/dsh-timeout'
import type { ToolExecutionResult } from '@phoenix-ai/dsh-tools'
import { apply as applyExecPolicy, type ExecPolicyConfig } from './exec-policy.ts'

export type { ExecPolicyConfig, ExecPolicyDecision, ExecPolicyEvaluation, ExecPolicyPatternPart, ExecPolicyRule } from './exec-policy.ts'
export { compileExecPolicy, evaluateExecPolicy } from './exec-policy.ts'

/** Guard configuration. Empty ExecPolicy rules preserve the historical behavior. */
export interface Config {
  /** Optional Codex-style command rules; omitted means pass-through. */
  readonly execPolicy?: ExecPolicyConfig
}

/**
 * The code owned by this plugin, used BOTH as the internal {@link deadline}
 * classification code AND as the structured error `code` on the replacement
 * tool result. Scoping {@link timeoutOf} to it keeps a nested outer deadline
 * (another `tools/execute` wrapper's timer that fired first) from being misread
 * as this plugin's own timeout — it reads as an ordinary upstream cancel.
 */
export const TOOL_TIMEOUT = 'TOOL_TIMEOUT'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'timeout-policy'

/** The tool registry service this plugin wraps (`tools/execute`) and reads (`get`). */
export const inject = ['tools']

/**
 * The structured result substituted when this plugin's deadline wins. `content`
 * is the model-facing message; `error.code` is the same {@link TOOL_TIMEOUT}
 * this plugin owns, so a retry/sandbox plugin (and replay) can route on it.
 *
 * @param timeoutMs - the elapsed budget, rendered into the model-facing message.
 * @returns the `isError` {@link ToolExecutionResult} with a `TOOL_TIMEOUT` error.
 */
function toolTimeoutResult(timeoutMs: number): ToolExecutionResult {
  const message = `tool call timed out after ${timeoutMs}ms`
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, info: { name: 'ToolTimeoutError', code: TOOL_TIMEOUT } },
  }
}

/**
 * Register the monotonic command-policy preflight and timeout wrapper. ExecPolicy
 * is pass-through with the default empty configuration; deployments can add
 * allow/prompt/forbidden rules without a second bundle row. An `allow` still
 * delegates, so it can never bypass approval, sandbox, HARDNESS, or later gates.
 */
export function apply(ctx: Context, config: Config = {}): void {
  applyExecPolicy(ctx, config.execPolicy)

  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const timeoutMs = ctx.tools.get(exec.name, exec.agent)?.timeoutMs
    // A tool that declares no budget: no deadline, delegate unchanged.
    if (timeoutMs === undefined) return next()

    using d = deadline(exec.signal, timeoutMs, TOOL_TIMEOUT)
    // Swap the derived deadline onto exec for dispatch, then restore the
    // caller's own signal so post-execute listeners never see this plugin's
    // (possibly already-aborted) timeout signal.
    const upstream = exec.signal
    exec.signal = d.signal
    try {
      const result = await next()
      // If OUR timer fired (scoped by code — a nested outer deadline reads as
      // undefined here), the tool/capability saw the abort and reached
      // quiescence; replace whatever it returned (its own abort result) with the
      // structured TOOL_TIMEOUT the model sees.
      if (timeoutOf(d.signal, TOOL_TIMEOUT) !== undefined) {
        return toolTimeoutResult(timeoutMs)
      }
      return result
    } finally {
      exec.signal = upstream
    }
  })
}
