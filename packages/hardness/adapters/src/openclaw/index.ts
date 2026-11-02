export { translateOpenClawManifest, validateOpenClawExtension } from './manifest.ts'
export {
  OPENCLAW_DONOR_COMMIT,
  OPENCLAW_EXTENSION_IDS,
  listOpenClawExtensions,
} from './catalog.ts'
export { toPhoenixCapabilities } from './capabilities.ts'
export { createOpenClawCompatibilityRuntime } from './runtime.ts'
export { toHardnessCapabilityDescriptors } from './hardness.ts'
export { OpenClawCapabilityBroker } from './broker.ts'
export {
  OPENCLAW_CORE_PACKAGE_SPEC,
  OpenClawPackageHost,
  registrationFamilyForOpenClawExtension,
  resolveOpenClawInstallCandidate,
} from './package-host.ts'
export type { OpenClawExtensionCatalogEntry } from './catalog.ts'
export type {
  PhoenixOpenClawCapability,
  PhoenixOpenClawCapabilityKind,
} from './capabilities.ts'
export type {
  OpenClawCapabilityHost,
  OpenClawExecutionContext,
  OpenClawPreparationResult,
  OpenClawBrokerDiagnostic,
} from './broker.ts'
export type {
  OpenClawInstallCandidate,
  OpenClawPackageInstaller,
  OpenClawPackagePrepareResult,
  OpenClawPreparedPackage,
  OpenClawRegistrationFamily,
} from './package-host.ts'
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
