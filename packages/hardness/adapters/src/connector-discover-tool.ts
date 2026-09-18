import type { McpConnectorEntry, McpConnectorRegistry } from '@phoenix-ai/dsh-mcp-connector-registry'
import {
  defineTool,
  ToolArgsError,
  type JsonValue,
  type ToolDefinition,
} from '@phoenix-ai/dsh-tools'

type McpConnectorListService = Pick<McpConnectorRegistry, 'list'>
type CandidateAction = 'use' | 'authorize' | 'repair' | 'install-with-user-approval' | 'do-not-install'

/** Secret-free Official MCP Registry package metadata supplied by the Host. */
export interface McpRegistryPackageView {
  readonly registryType: string
  readonly identifier: string
  readonly transport: 'stdio' | 'streamable-http' | 'sse'
  readonly version?: string
  readonly runtimeHint?: string
}

/** One sanitized Official MCP Registry discovery candidate supplied by the Host. */
export interface McpRegistryCandidateView {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly version: string
  readonly status: 'active' | 'deprecated' | 'deleted' | 'unknown'
  readonly trust: 'registry-listed'
  readonly transports: readonly ('stdio' | 'streamable-http' | 'sse')[]
  readonly packages: readonly McpRegistryPackageView[]
  readonly repositoryUrl?: string
  readonly websiteUrl?: string
  readonly remoteUrl?: string
}

/** Host-owned registry search seam. It carries no credentials. */
export interface McpRegistryDiscoveryService {
  searchMcpRegistry(request: { query: string; limit?: number }): Promise<{
    readonly source: 'official-mcp-registry'
    readonly query: string
    readonly fetchedAt: string
    readonly stale: boolean
    readonly candidates: readonly McpRegistryCandidateView[]
  }>
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function matchInstalled(candidate: McpRegistryCandidateView, installed: readonly McpConnectorEntry[]): McpConnectorEntry | undefined {
  const full = normalize(candidate.name)
  const short = normalize(candidate.name.slice(candidate.name.lastIndexOf('/') + 1))
  return installed.find((entry) => {
    const local = normalize(entry.serverName)
    return local === full || local === short || full.endsWith(`-${local}`) || short.endsWith(`-${local}`)
  })
}

function actionFor(candidate: McpRegistryCandidateView, entry: McpConnectorEntry | undefined): CandidateAction {
  if (entry?.status === 'ready') return 'use'
  if (entry?.status === 'auth-required') return 'authorize'
  if (entry !== undefined) return 'repair'
  if (candidate.status === 'deprecated' || candidate.status === 'deleted') return 'do-not-install'
  return 'install-with-user-approval'
}

function withInstalledState(
  candidate: McpRegistryCandidateView,
  installed: readonly McpConnectorEntry[],
): JsonValue {
  const entry = matchInstalled(candidate, installed)
  return {
    name: candidate.name,
    title: candidate.title,
    description: candidate.description,
    version: candidate.version,
    status: candidate.status,
    trust: candidate.trust,
    transports: [...candidate.transports],
    packages: candidate.packages.map(pkg => ({
      registryType: pkg.registryType,
      identifier: pkg.identifier,
      transport: pkg.transport,
      ...(pkg.version === undefined ? {} : { version: pkg.version }),
      ...(pkg.runtimeHint === undefined ? {} : { runtimeHint: pkg.runtimeHint }),
    })),
    ...(candidate.repositoryUrl === undefined ? {} : { repositoryUrl: candidate.repositoryUrl }),
    ...(candidate.websiteUrl === undefined ? {} : { websiteUrl: candidate.websiteUrl }),
    ...(candidate.remoteUrl === undefined ? {} : { remoteUrl: candidate.remoteUrl }),
    action: actionFor(candidate, entry),
    ...(entry === undefined ? {} : {
      installedConnectorId: `mcp:${entry.serverName}`,
      installedStatus: entry.status,
      ...(entry.reasonCode === undefined ? {} : { installedReasonCode: entry.reasonCode }),
    }),
  }
}

/**
 * Search only the public Official MCP Registry when the installed connector
 * inventory cannot satisfy a user's request.
 *
 * The Host owns network access, timeout, caching, and URL sanitization.
 * Registry metadata remains untrusted external data: a registry listing is
 * provenance, not authorization to execute code and not proof that the named
 * product vendor authored the server.
 * @param mcpConnectors - Secret-free inventory of currently configured MCP connectors.
 * @param registry - Host-owned Official MCP Registry search service, when available.
 * @returns A model-facing discovery tool that never installs code by itself.
 */
export function createConnectorDiscoverTool(
  mcpConnectors?: McpConnectorListService,
  registry?: McpRegistryDiscoveryService,
): ToolDefinition {
  return defineTool({
    name: 'connector_discover',
    description: 'Search the Official MCP Registry for a missing connector. Use connector_list first. A registry listing is discovery metadata, not proof of vendor authorship. Present the source and ask for explicit user approval before installing executable MCP code. If an installed connector is auth-required, present its authorization/reconnect flow instead of installing another copy.',
    parameters: {
      query: { type: 'string', required: true },
      limit: { type: 'number' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', const: 'connector_discovery', required: true },
          source: { type: 'string', const: 'official-mcp-registry', required: true },
          query: { type: 'string', required: true },
          registry_status: { type: 'string', enum: ['ok', 'unavailable'], required: true },
          fetched_at: { type: 'string' },
          stale: { type: 'boolean' },
          message: { type: 'string' },
          candidates: { type: 'array', items: { type: 'json' }, required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const query = args.query.trim()
      if (query.length < 2) throw new ToolArgsError(['query must contain at least 2 characters'])
      const rawLimit = args.limit ?? 8
      if (!Number.isFinite(rawLimit) || rawLimit < 1) throw new ToolArgsError(['limit must be a positive finite number'])
      const limit = Math.min(12, Math.trunc(rawLimit))
      if (registry === undefined) {
        return {
          kind: 'connector_discovery' as const,
          source: 'official-mcp-registry' as const,
          query,
          registry_status: 'unavailable' as const,
          message: 'Official MCP Registry search is unavailable in this Phoenix host. Do not substitute arbitrary GitHub MCP code automatically.',
          candidates: [],
        }
      }
      try {
        const result = await registry.searchMcpRegistry({ query, limit })
        const installed = mcpConnectors?.list() ?? []
        return {
          kind: 'connector_discovery' as const,
          source: result.source,
          query,
          registry_status: 'ok' as const,
          fetched_at: result.fetchedAt,
          stale: result.stale,
          candidates: result.candidates.map(candidate => withInstalledState(candidate, installed)),
        }
      } catch {
        return {
          kind: 'connector_discovery' as const,
          source: 'official-mcp-registry' as const,
          query,
          registry_status: 'unavailable' as const,
          message: 'The Official MCP Registry could not be reached. Do not substitute arbitrary GitHub MCP code automatically.',
          candidates: [],
        }
      }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: `Official MCP Registry: ${args.query}`,
        kind: 'search',
        rawInput: args.query,
      }
    },
  })
}
