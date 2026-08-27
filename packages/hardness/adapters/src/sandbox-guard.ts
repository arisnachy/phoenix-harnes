import type { HardnessService, CapabilityId } from '@deepseek-ai/dsh-hardness'
import type { ToolRuntime, ToolGuard } from '@deepseek-ai/dsh-tools'
export interface SandboxPolicyResolver {
  resolve: (request?: { readonly session?: unknown }) => { readonly mode: string; readonly workspaceRoot: string }
}

/** Install a fail-closed guard for descriptors declaring the sandbox modality. */
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
