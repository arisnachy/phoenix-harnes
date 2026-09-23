/**
 * Host-platform compatibility policy for stdio MCP servers.
 *
 * Explicit `supportedPlatforms` metadata wins. For existing configurations
 * that predate that metadata, a deliberately small known-server registry keeps
 * platform-bound servers from being spawned on an incompatible host.
 *
 * @module
 */

export const SUPPORTED_PLATFORMS = ['darwin', 'linux', 'win32'] as const
/**
 * Public supported platform shape.
 */
export type SupportedPlatform = typeof SUPPORTED_PLATFORMS[number]

/**
 * Public stdio platform descriptor shape.
 */
export interface StdioPlatformDescriptor {
  serverName: string
  command: string
  args?: readonly string[]
  supportedPlatforms?: readonly string[]
}

/**
 * Public platform compatibility shape.
 */
export interface PlatformCompatibility {
  compatible: boolean
  platform: NodeJS.Platform
  supportedPlatforms?: readonly SupportedPlatform[]
}

const VALID_PLATFORMS = new Set<string>(SUPPORTED_PLATFORMS)
const DARWIN_ONLY = Object.freeze(['darwin'] as const)

function normalizedSignature(config: StdioPlatformDescriptor): string {
  return [config.serverName, config.command, ...(config.args ?? [])]
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/**
 * Resolve the host platforms on which a stdio MCP server may run.
 *
 * Explicit metadata is authoritative. A narrow compatibility fallback handles
 * XcodeBuildMCP configurations created before Phoenix exposed platform metadata.
 * @param config - The config value.
 * @returns The resulting value.
 */
export function resolveSupportedPlatforms(config: StdioPlatformDescriptor): readonly SupportedPlatform[] | undefined {
  const explicit = config.supportedPlatforms ?? []
  if (explicit.length > 0) {
    const invalid = explicit.find((platform) => !VALID_PLATFORMS.has(platform))
    if (invalid !== undefined) {
      throw new Error(
        `mcp-client(${config.serverName}): unsupported platform value "${invalid}" in supportedPlatforms`,
      )
    }
    return [...new Set(explicit)] as SupportedPlatform[]
  }

  // Backwards compatibility for persisted configs that existed before
  // supportedPlatforms was introduced. Match the canonical package/server
  // token only, not generic "xcode", to avoid false positives.
  if (normalizedSignature(config).includes('xcodebuildmcp')) return DARWIN_ONLY
  return undefined
}

/**
 * Return whether this stdio MCP server may be started on the current host.
 * @param platform - The platform value.
 * @param config - The config value.
 * @returns The resulting value.
 */
export function checkPlatformCompatibility(
  config: StdioPlatformDescriptor,
  platform: NodeJS.Platform = process.platform,
): PlatformCompatibility {
  const supportedPlatforms = resolveSupportedPlatforms(config)
  if (supportedPlatforms === undefined) return { compatible: true, platform }
  return {
    compatible: supportedPlatforms.includes(platform as SupportedPlatform),
    platform,
    supportedPlatforms,
  }
}
