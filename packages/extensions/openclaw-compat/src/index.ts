export { translateOpenClawManifest, validateOpenClawExtension } from './manifest.ts'
export {
  OPENCLAW_DONOR_COMMIT,
  OPENCLAW_EXTENSION_IDS,
  listOpenClawExtensions,
} from './catalog.ts'
export type { OpenClawExtensionCatalogEntry } from './catalog.ts'
export type {
  CompatibilityEnvironment,
  CompatibilityReport,
  CompatibilityStatus,
  OpenClawActivationRules,
  OpenClawDashboard,
  PhoenixExtensionDescriptor,
} from './types.ts'
