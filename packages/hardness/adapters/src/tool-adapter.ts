import type { CapabilityId, HardnessService } from '@deepseek-ai/dsh-hardness/src/types.ts'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'

/** Event source used to observe dynamic tool-registry changes. */
export interface ToolChangeSource {
  on: (event: 'tools/change', listener: () => void) => () => void
}

/** Options for keeping projected tool capabilities synchronized. */
export interface ToolAtlasIndexOptions {
  readonly events?: ToolChangeSource
  readonly exclude?: readonly string[]
}

interface ToolRegistration {
  readonly signature: string
  readonly dispose: () => void
}

function toolSignature(schema: { readonly name: string; readonly description: string }): string {
  return `${schema.name}\u0000${schema.description}`
}

function registerTool(hardness: HardnessService, schema: { readonly name: string; readonly description: string }): ToolRegistration {
  return {
    signature: toolSignature(schema),
    dispose: hardness.register({
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
    }).dispose,
  }
}

/**
 * Project visible tool schemas into reversible HARDNESS registrations and
 * follow later registry changes when an event source is provided.
 * @param tools - canonical tool runtime queried for visible schemas.
 * @param hardness - HARDNESS registry receiving projected descriptors.
 * @param options - optional change source and names excluded from the atlas.
 * @returns disposer that retracts every projected tool capability.
 */
export function indexTools(
  tools: ToolRuntime,
  hardness: HardnessService,
  options: ToolAtlasIndexOptions = {},
): () => void {
  const excluded = new Set(options.exclude ?? [])
  const registrations = new Map<string, ToolRegistration>()
  let disposed = false

  const sync = (): void => {
    if (disposed) return
    const schemas = new Map(tools.schemas()
      .filter(schema => !excluded.has(schema.name))
      .map(schema => [schema.name, schema] as const))
    for (const [name, registration] of registrations) {
      const schema = schemas.get(name)
      if (schema === undefined || registration.signature !== toolSignature(schema)) {
        registration.dispose()
        registrations.delete(name)
      }
    }
    for (const [name, schema] of schemas) {
      if (!registrations.has(name)) registrations.set(name, registerTool(hardness, schema))
    }
  }

  sync()
  const removeListener = options.events?.on('tools/change', sync)
  return () => {
    if (disposed) return
    disposed = true
    removeListener?.()
    for (const registration of registrations.values()) registration.dispose()
    registrations.clear()
  }
}
