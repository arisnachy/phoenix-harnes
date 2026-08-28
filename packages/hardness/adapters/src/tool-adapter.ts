import type { HardnessService, CapabilityId } from '@deepseek-ai/dsh-hardness/src/types.ts'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'

/**
 * Project visible tool schemas into reversible HARDNESS registrations.
 * @param tools - canonical tool runtime queried for visible schemas.
 * @param hardness - HARDNESS registry receiving projected descriptors.
 * @returns disposer that retracts every projected tool capability.
 */
export function indexTools(tools: ToolRuntime, hardness: HardnessService): () => void {
  const disposers = tools.schemas().map(schema => hardness.register({
    id: `tool:${schema.name}` as CapabilityId,
    kind: 'tool',
    name: schema.name,
    description: schema.description,
    inputs: [],
    outputs: [],
    dependencies: [],
    requiredPermissions: [],
    provider: 'dsh-tools',
    location: 'tool-registry',
    version: '1.0.0',
    compatibility: [],
    limitations: [],
    modalities: ['native'],
    status: 'experimental',
  }).dispose)
  return () => { for (const dispose of disposers) dispose() }
}
