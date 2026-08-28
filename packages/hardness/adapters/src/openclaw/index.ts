export { translateOpenClawManifest, validateOpenClawExtension } from './manifest.ts'
export {
  OPENCLAW_DONOR_COMMIT,
  OPENCLAW_EXTENSION_IDS,
  listOpenClawExtensions,
} from './catalog.ts'
export { toPhoenixCapabilities } from './capabilities.ts'
export { createOpenClawCompatibilityRuntime } from './runtime.ts'
export { toHardnessCapabilityDescriptors } from './hardness.ts'
export type { OpenClawExtensionCatalogEntry } from './catalog.ts'
export type {
  PhoenixOpenClawCapability,
  PhoenixOpenClawCapabilityKind,
} from './capabilities.ts'
export type {
  OpenClawCompatibilityRuntime,
  OpenClawCompatibilityRuntimeOptions,
  OpenClawDiscoveryRecord,
  OpenClawRuntimeStatus,
} from './runtime.ts'
export type {
  CompatibilityEnvironment,
  CompatibilityReport,
  CompatibilityStatus,
  OpenClawActivationRules,
  OpenClawDashboard,
  PhoenixExtensionDescriptor,
} from './types.ts'
