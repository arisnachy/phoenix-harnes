import type {
  CompatibilityEnvironment,
  CompatibilityReport,
  OpenClawActivationRules,
  OpenClawDashboard,
  PhoenixExtensionDescriptor,
} from './types.ts'

const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
const SECRET_KEY_PATTERN = /token|password|secret|api[-_.]?key|apikey|credential|authorization/i

const KNOWN_MANIFEST_KEYS = new Set([
  'id',
  'name',
  'description',
  'activation',
  'configSchema',
  'uiHints',
  'contracts',
  'channels',
  'secretProviderIntegrations',
  'dashboard',
  'skills',
  'platforms',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map(entry => ({ ...entry }))
}

function redactSensitive(value: unknown, key?: string): unknown {
  if (key !== undefined && SECRET_KEY_PATTERN.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map(entry => redactSensitive(entry))
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactSensitive(entryValue, entryKey),
    ]),
  )
}

function activationRules(value: unknown): OpenClawActivationRules {
  const activation = isRecord(value) ? value : {}
  return {
    onStartup: activation.onStartup === true,
    onCommands: stringArray(activation.onCommands),
    onConfigPaths: stringArray(activation.onConfigPaths),
  }
}

function collectRequiredSecrets(uiHints: Record<string, unknown>): string[] {
  return Object.entries(uiHints)
    .filter(([, hint]) => isRecord(hint) && hint.sensitive === true)
    .map(([path]) => path)
    .sort()
}

function dashboard(value: unknown): OpenClawDashboard | undefined {
  if (!isRecord(value)) return undefined
  return {
    dataBindings: recordArray(value.dataBindings),
    actionVerbs: recordArray(value.actionVerbs),
  }
}

function unknownMetadata(manifest: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(manifest)
      .filter(([key]) => !KNOWN_MANIFEST_KEYS.has(key))
      .map(([key, value]) => [key, redactSensitive(value, key)]),
  )
}

/**
 * Translate OpenClaw manifest metadata into a Phoenix-safe descriptor.
 * @param manifestInput - Untrusted metadata parsed from an OpenClaw extension manifest.
 * @returns Normalized descriptor with sensitive unknown metadata redacted.
 */
export function translateOpenClawManifest(manifestInput: unknown): PhoenixExtensionDescriptor {
  if (!isRecord(manifestInput)) throw new TypeError('OpenClaw extension manifest must be an object')

  const id = manifestInput.id
  if (typeof id !== 'string' || !EXTENSION_ID_PATTERN.test(id)) {
    throw new TypeError('OpenClaw extension manifest id must be a lowercase extension identifier')
  }

  const name = typeof manifestInput.name === 'string' && manifestInput.name.length > 0
    ? manifestInput.name
    : id
  const uiHints = isRecord(manifestInput.uiHints) ? { ...manifestInput.uiHints } : {}
  const contracts = isRecord(manifestInput.contracts) ? manifestInput.contracts : {}
  const secretIntegrations = isRecord(manifestInput.secretProviderIntegrations)
    ? manifestInput.secretProviderIntegrations
    : {}
  const translatedDashboard = dashboard(manifestInput.dashboard)
  const configSchema = isRecord(manifestInput.configSchema) ? { ...manifestInput.configSchema } : undefined
  const description = typeof manifestInput.description === 'string' ? manifestInput.description : undefined

  return {
    id,
    name,
    ...(description === undefined ? {} : { description }),
    activation: activationRules(manifestInput.activation),
    ...(configSchema === undefined ? {} : { configSchema }),
    uiHints,
    tools: stringArray(contracts.tools),
    channels: stringArray(manifestInput.channels),
    secretProviders: Object.keys(secretIntegrations).sort(),
    requiredSecrets: collectRequiredSecrets(uiHints),
    platforms: stringArray(manifestInput.platforms),
    ...(translatedDashboard === undefined ? {} : { dashboard: translatedDashboard }),
    skills: stringArray(manifestInput.skills),
    openclawMetadata: unknownMetadata(manifestInput),
  }
}

/**
 * Validate a translated extension against the current Phoenix environment.
 * @param descriptor - Phoenix-safe OpenClaw extension descriptor.
 * @param environment - Platform and credential references available to activation.
 * @returns Explicit compatibility state without executing extension runtime code.
 */
export function validateOpenClawExtension(
  descriptor: PhoenixExtensionDescriptor,
  environment: CompatibilityEnvironment = {},
): CompatibilityReport {
  const platform = environment.platform ?? process.platform

  if (descriptor.platforms.length > 0 && !descriptor.platforms.includes(platform)) {
    return {
      status: 'UNSUPPORTED_PLATFORM',
      reasons: [`requires platform ${descriptor.platforms.join(', ')}; current platform is ${platform}`],
    }
  }

  const availableSecrets = new Set(environment.availableSecrets ?? [])
  const missingSecrets = descriptor.requiredSecrets.filter(secret => !availableSecrets.has(secret))
  if (missingSecrets.length > 0) {
    return {
      status: 'MISSING_SECRET',
      reasons: missingSecrets.map(secret => `missing secret reference ${secret}`),
    }
  }

  return { status: 'READY', reasons: [] }
}
