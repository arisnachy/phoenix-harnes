import type { HardnessService, CapabilityId } from '@phoenix-ai/dsh-hardness'
import type { ToolRuntime, ToolGuard } from '@phoenix-ai/dsh-tools'

/** Resolver that supplies the authoritative sandbox policy for one execution context. */
export interface SandboxPolicyResolver {
  resolve: (request?: { readonly session?: unknown }) => { readonly mode: string; readonly workspaceRoot: string }
}

/**
 * Install a fail-closed guard for descriptors declaring the sandbox modality.
 * @param tools - canonical tool runtime whose guard chain will be extended.
 * @param hardness - HARDNESS registry used to inspect tool capability descriptors.
 * @param sandboxPolicy - authoritative sandbox policy resolver, when available.
 * @returns disposer for the installed tool guard.
 */
export function installSandboxCapabilityGuard(
  tools: Pick<ToolRuntime, 'guard'>,
  hardness: Pick<HardnessService, 'get'>,
  sandboxPolicy: SandboxPolicyResolver | undefined,
): () => void {
  const guard: ToolGuard = (execution) => {
    const descriptor = hardness.get(`tool:${execution.name}` as CapabilityId)
    if (descriptor === undefined || !descriptor.modalities.includes('sandbox')) return undefined
    if (sandboxPolicy === undefined) return 'sandbox capability requires a resolved sandbox policy'
    const request = execution.agent === undefined ? {} : { session: execution.agent.session }
    sandboxPolicy.resolve(request)
    return undefined
  }
  return tools.guard(guard)
}
