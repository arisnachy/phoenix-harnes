/**
 * Repair legacy managed MCP loader dependencies before the profile parses
 * the persisted patch. Repairing them after startup is too late: Cordis has
 * already instantiated the plugin without authorization/credential services.
 */
import { readFile } from 'node:fs/promises'
import { withFileLock, writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'

const MANAGED_MCP_NAME = '@phoenix-ai/dsh-mcp-client'
const REQUIRED_INJECT = ['tools', 'credentials', 'authorization', 'mcpConnectors'] as const

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Atomically upgrade legacy managed MCP dependencies and the GitHub DCR
 * configuration, preserving endpoints, stored credentials, stable identities,
 * and installation order.
 * Called before runProfile sees managed.patch.yml.
 * @returns Number of rows repaired.
 */
export async function repairManagedMcpDependenciesBeforeBoot(path: string): Promise<number> {
  return withFileLock(path, async () => {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data) || data.length !== 1
      || !record(data[0]) || !Array.isArray(data[0].insert)) {
      throw new Error('managed MCP patch is invalid; refusing pre-boot migration')
    }
    let repaired = 0
    for (const rawRow of data[0].insert as unknown[]) {
      if (!record(rawRow) || rawRow.name !== MANAGED_MCP_NAME) continue
      if (!record(rawRow.config) || typeof rawRow.config.serverName !== 'string') {
        throw new Error('managed MCP row has an invalid config; refusing migration')
      }
      if (!['streamable-http', 'stdio'].includes(String(rawRow.config.transport))) {
        throw new Error('managed MCP row has an invalid transport; refusing migration')
      }
      // Legacy curated GitHub remote MCP installs were incorrectly configured
      // with OAuth DCR. GitHub explicitly does not support DCR on its remote
      // server. Convert only our pinned official endpoint and curated identity,
      // preserving all IDs, grants, other providers and credential values.
      if (rawRow.config.transport === 'streamable-http'
        && rawRow.config.serverName === 'github'
        && rawRow.config.url === 'https://api.githubcopilot.com/mcp/'
        && record(rawRow.source) && rawRow.source.kind === 'curated'
        && rawRow.source.connectorId === 'github'
        && (rawRow.config.oauth !== false
          || rawRow.config.bearerTokenRef !== 'GITHUB_MCP_TOKEN')) {
        rawRow.config.oauth = false
        rawRow.config.bearerTokenRef = 'GITHUB_MCP_TOKEN'
        repaired++
      }
      if (Array.isArray(rawRow.inject)
        && rawRow.inject.length === REQUIRED_INJECT.length
        && rawRow.inject.every((value, index) => value === REQUIRED_INJECT[index])) continue
      rawRow.inject = [...REQUIRED_INJECT]
      repaired++
    }
    if (repaired > 0) {
      await writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
    }
    return repaired
  }, { waitMs: 15_000 })
}
