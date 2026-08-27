import type { Agent } from '@deepseek-ai/dsh-agent'
import type { HardnessService, CapabilityNeed, CapabilitySurface } from '@deepseek-ai/dsh-hardness'
import type { ToolRuntime, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

export interface CapabilityExecutionContext {
  readonly callId: import('@deepseek-ai/dsh-llm').CallId
  readonly signal: AbortSignal
  readonly agent?: Agent
}

export interface CapabilityApproval {
  request: (surface: CapabilitySurface, context: { readonly agent?: Agent; readonly signal: AbortSignal }) => Promise<{ readonly kind: 'approved'; readonly grants: readonly string[] } | { readonly kind: 'denied'; readonly reason: string }>
}

export type CapabilityExecutionResult =
  | { readonly kind: 'executed'; readonly result: ToolExecutionResult }
  | { readonly kind: 'denied'; readonly reason: string }
  | { readonly kind: 'missing'; readonly reasons: readonly string[] }
  | { readonly kind: 'unsupported'; readonly reason: string }

export async function executeCapabilityNeed(
  hardness: Pick<HardnessService, 'route' | 'surface'>,
  tools: Pick<ToolRuntime, 'execute'>,
  approval: CapabilityApproval,
  need: CapabilityNeed,
  args: unknown,
  context: CapabilityExecutionContext,
): Promise<CapabilityExecutionResult> {
  const routed = hardness.route(need)
  if (routed.kind !== 'route') return { kind: 'missing', reasons: routed.reasons }
  const surface = hardness.surface(routed)
  if (surface === undefined) return { kind: 'unsupported', reason: 'route did not produce a capability surface' }
  if (!surface.capabilityId.startsWith('tool:')) return { kind: 'unsupported', reason: `capability location is not a tool: ${surface.capabilityId}` }
  const approvalContext = {
    ...(context.agent === undefined ? {} : { agent: context.agent }),
    signal: context.signal,
  }
  const decision = await approval.request(surface, approvalContext)
  if (decision.kind !== 'approved') return decision
  const input = {
    callId: context.callId,
    name: surface.capabilityId.slice('tool:'.length),
    arguments: args,
    signal: context.signal,
    ...(context.agent === undefined ? {} : { agent: context.agent }),
  }
  return { kind: 'executed', result: await tools.execute(input) }
}
