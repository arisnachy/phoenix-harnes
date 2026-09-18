import type {
  McpRegistryCandidate,
  McpRegistryPackage,
  McpRegistrySearchRequest,
  McpRegistrySearchSnapshot,
  McpRegistryTransport,
} from './types.ts'

const OFFICIAL_MCP_REGISTRY = 'https://registry.modelcontextprotocol.io'
const CACHE_TTL_MS = 5 * 60 * 1000
const STALE_TTL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 6000
const MAX_CACHE_ENTRIES = 64

interface CachedSearch {
  at: number
  snapshot: McpRegistrySearchSnapshot
}

const cache = new Map<string, CachedSearch>()

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function safeHttpsUrl(value: unknown): string | undefined {
  const raw = text(value)
  if (raw === undefined) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function transportOf(value: unknown): McpRegistryTransport | undefined {
  const type = text(record(value)?.type)
  if (type === 'stdio' || type === 'streamable-http' || type === 'sse') return type
  return undefined
}

function projectPackages(server: Record<string, unknown>): McpRegistryPackage[] {
  if (!Array.isArray(server.packages)) return []
  return server.packages.flatMap((value) => {
    const item = record(value)
    if (item === undefined) return []
    const registryType = text(item.registryType)
    const identifier = text(item.identifier)
    const transport = transportOf(item.transport)
    if (registryType === undefined || identifier === undefined || transport === undefined) return []
    const version = text(item.version)
    const runtimeHint = text(item.runtimeHint)
    return [{
      registryType,
      identifier,
      transport,
      ...(version === undefined ? {} : { version }),
      ...(runtimeHint === undefined ? {} : { runtimeHint }),
    }]
  })
}

function registryStatus(response: Record<string, unknown>): McpRegistryCandidate['status'] {
  const meta = record(response._meta)
  const official = record(meta?.['io.modelcontextprotocol.registry/official'])
  const status = text(official?.status)
  return status === 'active' || status === 'deprecated' || status === 'deleted' ? status : 'unknown'
}

function projectCandidate(value: unknown): McpRegistryCandidate | undefined {
  const response = record(value)
  const server = record(response?.server)
  if (response === undefined || server === undefined) return undefined
  const name = text(server.name)
  const description = text(server.description)
  const version = text(server.version)
  if (name === undefined || description === undefined || version === undefined) return undefined

  const packages = projectPackages(server)
  const remotes = Array.isArray(server.remotes) ? server.remotes : []
  const remoteTransports: McpRegistryTransport[] = []
  let remoteUrl: string | undefined
  for (const remote of remotes) {
    const item = record(remote)
    const transport = transportOf(item)
    if (transport === undefined) continue
    remoteTransports.push(transport)
    if (remoteUrl === undefined && transport === 'streamable-http') {
      const candidate = safeHttpsUrl(item?.url)
      if (candidate !== undefined && !candidate.includes('{')) remoteUrl = candidate
    }
  }
  const transports = [...new Set<McpRegistryTransport>([
    ...remoteTransports,
    ...packages.map(pkg => pkg.transport),
  ])]

  const repository = record(server.repository)
  const repositoryUrl = safeHttpsUrl(repository?.url)
  const websiteUrl = safeHttpsUrl(server.websiteUrl)
  const title = text(server.title)

  return {
    name,
    title: title ?? name,
    description,
    version,
    status: registryStatus(response),
    trust: 'registry-listed',
    transports,
    packages,
    ...(repositoryUrl === undefined ? {} : { repositoryUrl }),
    ...(websiteUrl === undefined ? {} : { websiteUrl }),
    ...(remoteUrl === undefined ? {} : { remoteUrl }),
  }
}

function normalizeRequest(request: McpRegistrySearchRequest): { query: string; limit: number } {
  const query = request.query.trim()
  if (query.length < 2) throw new Error('MCP registry search requires at least 2 characters.')
  const rawLimit = request.limit ?? 12
  if (!Number.isFinite(rawLimit)) throw new Error('MCP registry search limit must be finite.')
  return { query, limit: Math.max(1, Math.min(20, Math.trunc(rawLimit))) }
}

function remember(key: string, snapshot: McpRegistrySearchSnapshot): void {
  cache.delete(key)
  cache.set(key, { at: Date.now(), snapshot })
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function staleSnapshot(hit: CachedSearch): McpRegistrySearchSnapshot {
  return { ...hit.snapshot, stale: true }
}

/**
 * Search the public Official MCP Registry through the Host, avoiding browser
 * CORS failures and keeping a bounded stale cache for short registry outages.
 *
 * Registry-listed is provenance, not a claim that the vendor named by a server
 * title published it. Callers should show repository/publisher provenance and
 * require user approval before installing executable packages.
 */
export async function searchOfficialMcpRegistry(
  request: McpRegistrySearchRequest,
): Promise<McpRegistrySearchSnapshot> {
  const { query, limit } = normalizeRequest(request)
  const key = `${query.toLowerCase()}\u0000${limit}`
  const hit = cache.get(key)
  const now = Date.now()
  if (hit !== undefined && now - hit.at <= CACHE_TTL_MS) return hit.snapshot

  const url = new URL('/v0.1/servers', OFFICIAL_MCP_REGISTRY)
  url.searchParams.set('search', query)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('version', 'latest')

  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
  timeout.unref?.()
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`registry returned HTTP ${response.status}`)
    const payload = record(await response.json())
    if (!Array.isArray(payload?.servers)) throw new Error('registry returned an invalid server list')
    const candidates = payload.servers.flatMap((entry) => {
      const candidate = projectCandidate(entry)
      return candidate === undefined ? [] : [candidate]
    })
    const snapshot: McpRegistrySearchSnapshot = {
      source: 'official-mcp-registry',
      query,
      fetchedAt: new Date().toISOString(),
      stale: false,
      candidates,
    }
    remember(key, snapshot)
    return snapshot
  } catch (error) {
    if (hit !== undefined && now - hit.at <= STALE_TTL_MS) return staleSnapshot(hit)
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Official MCP Registry lookup failed: ${message}`)
  } finally {
    clearTimeout(timeout)
  }
}
