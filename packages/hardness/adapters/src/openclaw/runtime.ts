import { listOpenClawExtensions } from './catalog.ts'
import type { OpenClawExtensionCatalogEntry } from './catalog.ts'
import { toPhoenixCapabilities } from './capabilities.ts'
import type { PhoenixOpenClawCapability } from './capabilities.ts'
import { translateOpenClawManifest, validateOpenClawExtension } from './manifest.ts'
import type {
  CompatibilityEnvironment,
  CompatibilityReport,
  PhoenixExtensionDescriptor,
} from './types.ts'

/** Metadata-only discovery record published before any extension code executes. */
export interface OpenClawDiscoveryRecord {
  entry: OpenClawExtensionCatalogEntry
  capabilities: PhoenixOpenClawCapability[]
}

/** Runtime status for one OpenClaw extension under Phoenix control. */
export interface OpenClawRuntimeStatus extends CompatibilityReport {
  id: string
  active: boolean
}

/** Phoenix-owned hooks used by the OpenClaw compatibility runtime. */
export interface OpenClawCompatibilityRuntimeOptions {
  catalog?: readonly OpenClawExtensionCatalogEntry[]
  environment?: CompatibilityEnvironment
  loadManifest: (entry: OpenClawExtensionCatalogEntry) => unknown | Promise<unknown>
  activateExtension: (descriptor: PhoenixExtensionDescriptor) => void | Promise<void>
  deactivateExtension?: (descriptor: PhoenixExtensionDescriptor) => void | Promise<void>
}

/** Lazy discovery and activation surface for OpenClaw extensions. */
export interface OpenClawCompatibilityRuntime {
  discover(): OpenClawDiscoveryRecord[]
  status(id: string): Promise<OpenClawRuntimeStatus>
  activate(id: string): Promise<OpenClawRuntimeStatus>
  deactivate(id: string): Promise<boolean>
  isActive(id: string): boolean
}

interface ResolvedExtension {
  descriptor?: PhoenixExtensionDescriptor
  status: OpenClawRuntimeStatus
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

function withIdentity(
  id: string,
  report: CompatibilityReport,
  active: boolean,
): OpenClawRuntimeStatus {
  return { id, status: report.status, reasons: [...report.reasons], active }
}

/**
 * Create a lazy compatibility runtime subordinate to Phoenix activation hooks.
 * @param options - Pinned catalog, environment facts, and Phoenix-owned runtime hooks.
 * @returns Runtime that discovers metadata without eager extension execution.
 */
export function createOpenClawCompatibilityRuntime(
  options: OpenClawCompatibilityRuntimeOptions,
): OpenClawCompatibilityRuntime {
  const catalog = (options.catalog ?? listOpenClawExtensions()).map(entry => ({ ...entry }))
  const byId = new Map(catalog.map(entry => [entry.id, entry]))
  const active = new Map<string, PhoenixExtensionDescriptor>()

  const resolve = async (id: string): Promise<ResolvedExtension> => {
    const entry = byId.get(id)
    if (entry === undefined) {
      return {
        status: {
          id,
          status: 'INCOMPATIBLE_CONTRACT',
          reasons: [`unknown OpenClaw extension ${id}`],
          active: false,
        },
      }
    }

    try {
      const manifest = await options.loadManifest({ ...entry })
      const descriptor = translateOpenClawManifest(manifest)
      const report = validateOpenClawExtension(descriptor, options.environment)
      return {
        descriptor,
        status: withIdentity(id, report, active.has(id)),
      }
    } catch (error) {
      return {
        status: {
          id,
          status: 'INCOMPATIBLE_CONTRACT',
          reasons: [errorText(error)],
          active: false,
        },
      }
    }
  }

  return {
    discover() {
      return catalog.map(entry => ({
        entry: { ...entry },
        capabilities: toPhoenixCapabilities(entry),
      }))
    },

    async status(id) {
      return (await resolve(id)).status
    },

    async activate(id) {
      if (active.has(id)) return { id, status: 'READY', reasons: [], active: true }

      const resolved = await resolve(id)
      if (resolved.status.status !== 'READY' || resolved.descriptor === undefined) {
        return resolved.status
      }

      try {
        await options.activateExtension(resolved.descriptor)
        active.set(id, resolved.descriptor)
        return { id, status: 'READY', reasons: [], active: true }
      } catch (error) {
        return {
          id,
          status: 'ACTIVATION_FAILED',
          reasons: [errorText(error)],
          active: false,
        }
      }
    },

    async deactivate(id) {
      const descriptor = active.get(id)
      if (descriptor === undefined) return false
      if (options.deactivateExtension !== undefined) await options.deactivateExtension(descriptor)
      active.delete(id)
      return true
    },

    isActive(id) {
      return active.has(id)
    },
  }
}
