import { OPENCLAW_EXTENSION_IDS } from './catalog.generated.ts'

/** Immutable OpenClaw stable-release donor revision used to build the compatibility catalog. */
export const OPENCLAW_DONOR_COMMIT = 'eb377ac59e6c9fd6c7705028034812becf00271b' as const

/** Metadata-only locator for one extension in the pinned OpenClaw donor tree. */
export interface OpenClawExtensionCatalogEntry {
  id: string
  sourcePath: string
  manifestPath: string
  donorCommit: typeof OPENCLAW_DONOR_COMMIT
}

const CATALOG: readonly OpenClawExtensionCatalogEntry[] = OPENCLAW_EXTENSION_IDS.map(id => ({
  id,
  sourcePath: `extensions/${id}`,
  manifestPath: `extensions/${id}/openclaw.plugin.json`,
  donorCommit: OPENCLAW_DONOR_COMMIT,
}))

/**
 * Return an isolated copy of the pinned OpenClaw extension catalog.
 * @returns Copy-safe catalog entries for discovery and capability indexing.
 */
export function listOpenClawExtensions(): OpenClawExtensionCatalogEntry[] {
  return CATALOG.map(entry => ({ ...entry }))
}

export { OPENCLAW_EXTENSION_IDS }
