/** Compatibility states reported without crashing Phoenix startup. */
export type CompatibilityStatus =
  | 'READY'
  | 'MISSING_DEPENDENCY'
  | 'MISSING_SECRET'
  | 'UNSUPPORTED_PLATFORM'
  | 'POLICY_BLOCKED'
  | 'INCOMPATIBLE_CONTRACT'
  | 'ACTIVATION_FAILED'

/** Lazy activation hints translated from an OpenClaw manifest. */
export interface OpenClawActivationRules {
  onStartup: boolean
  onCommands: string[]
  onConfigPaths: string[]
}

/** Dashboard declarations preserved by the compatibility translator. */
export interface OpenClawDashboard {
  dataBindings: Record<string, unknown>[]
  actionVerbs: Record<string, unknown>[]
}

/** Phoenix-safe descriptor translated from OpenClaw plugin metadata. */
export interface PhoenixExtensionDescriptor {
  id: string
  name: string
  description?: string
  activation: OpenClawActivationRules
  configSchema?: Record<string, unknown>
  uiHints: Record<string, unknown>
  tools: string[]
  channels: string[]
  secretProviders: string[]
  requiredSecrets: string[]
  platforms: string[]
  dashboard?: OpenClawDashboard
  skills: string[]
  openclawMetadata: Record<string, unknown>
}

/** Runtime facts used to validate a translated extension before activation. */
export interface CompatibilityEnvironment {
  platform?: string
  availableSecrets?: readonly string[]
}

/** Compatibility result with actionable, secret-free reasons. */
export interface CompatibilityReport {
  status: CompatibilityStatus
  reasons: string[]
}
