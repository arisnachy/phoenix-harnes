import type { HardnessService, CapabilityId } from '@deepseek-ai/dsh-hardness/src/types.ts'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toolContract(parameters: unknown): {
  readonly inputs: readonly string[]
  readonly compatibility: readonly string[]
} {
  if (!isRecord(parameters)) return { inputs: [], compatibility: [] }
  const properties = isRecord(parameters.properties) ? Object.keys(parameters.properties).sort() : []
  const compatibility = typeof parameters.type === 'string' ? [`json-schema:${parameters.type}`] : []
  return { inputs: properties, compatibility }
}

/**
 * Project visible tool schemas into reversible HARDNESS registrations.
 * @param tools - canonical tool runtime queried for visible schemas.
 * @param hardness - HARDNESS registry receiving projected descriptors.
 * @returns disposer that retracts every projected tool capability.
 */
export function indexTools(tools: ToolRuntime, hardness: HardnessService): () => void {
  const disposers = tools.schemas().map(schema => {
    const contract = toolContract(schema.parameters)
    return hardness.register({
      id: `tool:${schema.name}` as CapabilityId,
      kind: schema.name,
      name: schema.name,
      description: schema.description,
      inputs: [...contract.inputs],
      outputs: [],
      dependencies: [],
      requiredPermissions: [],
      provider: 'dsh-tools',
      location: 'tool-registry',
      version: '1.0.0',
      compatibility: [...contract.compatibility],
      limitations: ['output contract unavailable from model-visible tool schema'],
      modalities: ['native'],
      status: 'experimental',
    }).dispose
  })
  return () => { for (const dispose of disposers) dispose() }
}
