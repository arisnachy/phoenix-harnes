export type CompatibilityStatus =
  | 'READY'
  | 'MISSING_DEPENDENCY'
  | 'MISSING_SECRET'
  | 'UNSUPPORTED_PLATFORM'
  | 'POLICY_BLOCKED'
  | 'INCOMPATIBLE_CONTRACT'
  | 'ACTIVATION_FAILED'

export interface OpenClawActivationRules {
  onStartup: boolean
  onCommands: string[]
  onConfigPaths: string[]
}

export interface OpenClawDashboard {
  dataBindings: Record<string, unknown>[]
  actionVerbs: Record<string, unknown>[]
}

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

export interface CompatibilityEnvironment {
  platform?: string
  availableSecrets?: readonly string[]
}

export interface CompatibilityReport {
  status: CompatibilityStatus
  reasons: string[]
}
