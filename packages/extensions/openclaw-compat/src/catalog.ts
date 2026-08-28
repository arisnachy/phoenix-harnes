import { OPENCLAW_EXTENSION_IDS } from './catalog.generated.ts'

export const OPENCLAW_DONOR_COMMIT = '515c3d8ff3fce77838d69d1da838ad691c18d755' as const

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

export function listOpenClawExtensions(): OpenClawExtensionCatalogEntry[] {
  return CATALOG.map(entry => ({ ...entry }))
}

export { OPENCLAW_EXTENSION_IDS }
