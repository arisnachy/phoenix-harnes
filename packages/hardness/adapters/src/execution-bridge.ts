import type { Agent } from '@deepseek-ai/dsh-agent'
import type { HardnessService, CapabilityNeed, CapabilitySurface } from '@deepseek-ai/dsh-hardness'
import type { ToolRuntime, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** Invocation context shared by native tools and external capability executors. */
export interface CapabilityExecutionContext {
  readonly callId: import('@deepseek-ai/dsh-llm').CallId
  readonly signal: AbortSignal
  readonly agent?: Agent
}

/** Approval broker applied before any governed HARDNESS side effect. */
export interface CapabilityApproval {
  request: (surface: CapabilitySurface, context: { readonly agent?: Agent; readonly signal: AbortSignal }) => Promise<{ readonly kind: 'approved'; readonly grants: readonly string[] } | { readonly kind: 'denied'; readonly reason: string }>
}

/** Executor seam for non-tool capability families such as `openclaw:*`. */
export interface CapabilityExecutor {
  supports(surface: CapabilitySurface): boolean
  execute(surface: CapabilitySurface, args: unknown, context: CapabilityExecutionContext): Promise<ToolExecutionResult>
}

/** Governed result of resolving, approving, and dispatching one capability need. */
export type CapabilityExecutionResult =
  | { readonly kind: 'executed'; readonly result: ToolExecutionResult; readonly surface: CapabilitySurface }
  | { readonly kind: 'denied'; readonly reason: string }
  | { readonly kind: 'missing'; readonly reasons: readonly string[] }
  | { readonly kind: 'unsupported'; readonly reason: string }

/**
 * Route one need, require approval, then dispatch either a Phoenix tool or a
 * compatible external executor. No non-tool surface is executed implicitly.
 */
export async function executeCapabilityNeed(
  hardness: Pick<HardnessService, 'route' | 'surface'>,
  tools: Pick<ToolRuntime, 'execute'>,
  approval: CapabilityApproval,
  need: CapabilityNeed,
  args: unknown,
  context: CapabilityExecutionContext,
  external?: CapabilityExecutor,
): Promise<CapabilityExecutionResult> {
  const routed = hardness.route(need)
  if (routed.kind !== 'route') return { kind: 'missing', reasons: routed.reasons }
  const surface = hardness.surface(routed)
  if (surface === undefined) return { kind: 'unsupported', reason: 'route did not produce a capability surface' }

  const isTool = surface.capabilityId.startsWith('tool:')
  const isExternal = !isTool && external?.supports(surface) === true
  if (!isTool && !isExternal) {
    return { kind: 'unsupported', reason: `no executor owns capability: ${surface.capabilityId}` }
  }

  const approvalContext = {
    ...(context.agent === undefined ? {} : { agent: context.agent }),
    signal: context.signal,
  }
  const decision = await approval.request(surface, approvalContext)
  if (decision.kind !== 'approved') return decision

  if (isExternal) {
    return {
      kind: 'executed',
      result: await external.execute(surface, args, context),
      surface,
    }
  }

  const input = {
    callId: context.callId,
    name: surface.capabilityId.slice('tool:'.length),
    arguments: args,
    signal: context.signal,
    ...(context.agent === undefined ? {} : { agent: context.agent }),
  }
  return { kind: 'executed', result: await tools.execute(input), surface }
}
