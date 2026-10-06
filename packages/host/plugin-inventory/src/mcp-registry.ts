import type {
  McpRegistryCandidate,
  McpRegistryIcon,
  McpRegistryPackage,
  McpRegistrySearchRequest,
  McpRegistrySearchSnapshot,
  McpRegistryTransport,
} from './types.ts'

const OFFICIAL_MCP_REGISTRY = 'https://registry.modelcontextprotocol.io'
const CACHE_TTL_MS = 5 * 60 * 1000
const STALE_TTL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000
const REQUEST_ATTEMPTS = 2
const RETRY_DELAY_MS = 150
const MAX_CACHE_ENTRIES = 64

interface CachedSearch {
  at: number
  snapshot: McpRegistrySearchSnapshot
}

const cache = new Map<string, CachedSearch>()
const inFlight = new Map<string, Promise<McpRegistrySearchSnapshot>>()

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

const ICON_MIME_TYPES = new Set<McpRegistryIcon['mimeType']>([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
  'image/webp',
])

function projectIcons(server: Record<string, unknown>): McpRegistryIcon[] {
  if (!Array.isArray(server.icons)) return []
  return server.icons.flatMap((value) => {
    const item = record(value)
    if (item === undefined) return []
    const src = safeHttpsUrl(item.src)
    if (src === undefined) return []
    const rawMime = text(item.mimeType)?.toLowerCase()
    const mimeType = rawMime !== undefined && ICON_MIME_TYPES.has(rawMime as McpRegistryIcon['mimeType'])
      ? rawMime as McpRegistryIcon['mimeType']
      : undefined
    const sizes = Array.isArray(item.sizes)
      ? item.sizes.flatMap((size) => {
        const normalized = text(size)
        return normalized !== undefined && (normalized === 'any' || /^\d+x\d+$/.test(normalized))
          ? [normalized]
          : []
      })
      : []
    return [{
      src,
      ...(mimeType === undefined ? {} : { mimeType }),
      ...(sizes.length === 0 ? {} : { sizes }),
    }]
  })
}

function transportOf(value: unknown): McpRegistryTransport | undefined {
  const type = text(record(value)?.type)
  if (type === 'stdio' || type === 'streamable-http' || type === 'sse') return type
  return undefined
}

function inputString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function projectArgument(value: unknown): McpRegistryPackage['runtimeArguments'][number] | undefined {
  const item = record(value)
  if (item === undefined) return undefined
  const type = text(item.type)
  if (type !== 'positional' && type !== 'named') return undefined
  const name = text(item.name)
  if (type === 'named' && name === undefined) return undefined
  const valueText = inputString(item.value)
  const defaultValue = inputString(item.default)
  const valueHint = text(item.valueHint)
  return {
    type,
    isRequired: item.isRequired === true,
    isSecret: item.isSecret === true,
    isRepeated: item.isRepeated === true,
    ...(name === undefined ? {} : { name }),
    ...(valueText === undefined ? {} : { value: valueText }),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(valueHint === undefined ? {} : { valueHint }),
  }
}

function projectArguments(value: unknown): McpRegistryPackage['runtimeArguments'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const projected = projectArgument(item)
    return projected === undefined ? [] : [projected]
  })
}

function projectEnvironmentVariables(value: unknown): McpRegistryPackage['environmentVariables'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const item = record(entry)
    if (item === undefined) return []
    const name = text(item.name)
    if (name === undefined) return []
    const valueText = inputString(item.value)
    const defaultValue = inputString(item.default)
    return [{
      name,
      isRequired: item.isRequired === true,
      isSecret: item.isSecret === true,
      ...(valueText === undefined ? {} : { value: valueText }),
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
    }]
  })
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
    const registryBaseUrl = safeHttpsUrl(item.registryBaseUrl)
    return [{
      registryType,
      identifier,
      transport,
      runtimeArguments: projectArguments(item.runtimeArguments),
      packageArguments: projectArguments(item.packageArguments),
      environmentVariables: projectEnvironmentVariables(item.environmentVariables),
      ...(version === undefined ? {} : { version }),
      ...(runtimeHint === undefined ? {} : { runtimeHint }),
      ...(registryBaseUrl === undefined ? {} : { registryBaseUrl }),
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

  const icons = projectIcons(server)
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
      // Phoenix can auto-install only remotes whose connection recipe is fully
      // represented by the URL/OAuth transport today. Registry-declared custom
      // headers must not be silently discarded or the connector will be born broken.
      const hasCustomHeaders = Array.isArray(item?.headers) && item.headers.length > 0
      const candidate = safeHttpsUrl(item?.url)
      if (!hasCustomHeaders && candidate !== undefined && !candidate.includes('{')) remoteUrl = candidate
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
    icons,
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
    // size > 0 guarantees iterator.value; no defensive empty branch is needed.
    const oldest = cache.keys().next().value as string
    cache.delete(oldest)
  }
}

function staleSnapshot(hit: CachedSearch): McpRegistrySearchSnapshot {
  return { ...hit.snapshot, stale: true }
}

class RegistryHttpError extends Error {
  constructor(readonly status: number) {
    super(`registry returned HTTP ${status}`)
  }
}

function registrySnapshot(
  query: string,
  candidates: McpRegistryCandidate[],
): McpRegistrySearchSnapshot {
  return {
    source: 'official-mcp-registry',
    query,
    fetchedAt: new Date().toISOString(),
    stale: false,
    candidates,
  }
}

function isTransientFetchFailure(error: Error): boolean {
  const code = String((error as Error & { code?: unknown }).code ?? '').toUpperCase()
  const message = error.message.toLowerCase()
  return error.name === 'AbortError'
    || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(code)
    || ['fetch failed', 'network error', 'networkerror', 'socket', 'timed out', 'timeout', 'aborted']
      .some(fragment => message.includes(fragment))
}

async function retryDelay(): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, RETRY_DELAY_MS)
    timer.unref()
  })
}

async function fetchRegistryJson(url: URL): Promise<unknown> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
    timeout.unref()
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) throw new RegistryHttpError(response.status)
      return await response.json()
    } catch (error) {
      const normalized = controller.signal.aborted
        ? new Error(`registry request timed out after ${REQUEST_TIMEOUT_MS}ms`)
        : error instanceof Error
          ? error
          : new Error(String(error))
      lastError = normalized
      if (attempt + 1 >= REQUEST_ATTEMPTS || !isTransientFetchFailure(normalized)) throw normalized
    } finally {
      clearTimeout(timeout)
    }
    await retryDelay()
  }
  throw lastError ?? new Error('registry request failed')
}

function looksLikeExactRegistryName(query: string): boolean {
  return query.includes('/') && !/\s/.test(query)
}

async function fetchFreshRegistrySnapshot(
  query: string,
  limit: number,
): Promise<McpRegistrySearchSnapshot> {
  if (looksLikeExactRegistryName(query)) {
    const detailUrl = new URL(
      `/v0.1/servers/${encodeURIComponent(query)}/versions/latest`,
      OFFICIAL_MCP_REGISTRY,
    )
    try {
      const candidate = projectCandidate(await fetchRegistryJson(detailUrl))
      if (candidate !== undefined && candidate.name === query) {
        return registrySnapshot(query, [candidate])
      }
    } catch (error) {
      if (!(error instanceof RegistryHttpError) || error.status !== 404) throw error
    }
  }

  const url = new URL('/v0.1/servers', OFFICIAL_MCP_REGISTRY)
  url.searchParams.set('search', query)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('version', 'latest')
  const payload = record(await fetchRegistryJson(url))
  if (!Array.isArray(payload?.servers)) throw new Error('registry returned an invalid server list')
  const candidates = payload.servers.flatMap((entry) => {
    const candidate = projectCandidate(entry)
    return candidate === undefined ? [] : [candidate]
  })
  return registrySnapshot(query, candidates)
}

function cachedCandidateMatches(candidate: McpRegistryCandidate, normalizedQuery: string): boolean {
  return [candidate.name, candidate.title, candidate.description]
    .some(value => value.toLowerCase().includes(normalizedQuery))
}

function relatedStaleSnapshot(
  query: string,
  limit: number,
  now: number,
): McpRegistrySearchSnapshot | undefined {
  const normalizedQuery = query.toLowerCase()
  const candidates = new Map<string, McpRegistryCandidate>()
  let freshest = 0
  for (const hit of cache.values()) {
    if (now - hit.at > STALE_TTL_MS) continue
    freshest = Math.max(freshest, hit.at)
    for (const candidate of hit.snapshot.candidates) {
      if (!cachedCandidateMatches(candidate, normalizedQuery)) continue
      candidates.set(`${candidate.name}\u0000${candidate.version}`, candidate)
      if (candidates.size >= limit) break
    }
    if (candidates.size >= limit) break
  }
  if (candidates.size === 0) return undefined
  return {
    source: 'official-mcp-registry',
    query,
    fetchedAt: new Date(freshest).toISOString(),
    stale: true,
    candidates: [...candidates.values()].slice(0, limit),
  }
}

/**
 * Search the public Official MCP Registry through the Host, avoiding browser
 * CORS failures and keeping a bounded stale cache for short registry outages.
 *
 * Exact registry identities use the server-detail endpoint first, which avoids
 * a full text search for install/reconnect flows. Transient network/AbortError
 * failures receive one bounded retry; duplicate identical searches share the
 * same in-flight request.
 *
 * Registry-listed is provenance, not a claim that the vendor named by a server
 * title published it. Callers should show repository/publisher provenance and
 * require user approval before installing executable packages.
 * @param request - Registry query and optional bounded result limit.
 * @returns Sanitized registry metadata, using a short-lived cache when possible.
 */
export async function searchOfficialMcpRegistry(
  request: McpRegistrySearchRequest,
): Promise<McpRegistrySearchSnapshot> {
  const { query, limit } = normalizeRequest(request)
  const key = `${query.toLowerCase()}\u0000${limit}`
  const hit = cache.get(key)
  const now = Date.now()
  if (hit !== undefined && now - hit.at <= CACHE_TTL_MS) return hit.snapshot

  const active = inFlight.get(key)
  if (active !== undefined) return active

  const pending = (async (): Promise<McpRegistrySearchSnapshot> => {
    try {
      const snapshot = await fetchFreshRegistrySnapshot(query, limit)
      remember(key, snapshot)
      return snapshot
    } catch (error) {
      const fallbackNow = Date.now()
      const exactHit = cache.get(key)
      if (exactHit !== undefined && fallbackNow - exactHit.at <= STALE_TTL_MS) {
        return staleSnapshot(exactHit)
      }
      const related = relatedStaleSnapshot(query, limit, fallbackNow)
      if (related !== undefined) return related
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Official MCP Registry lookup failed: ${message}`)
    }
  })()

  inFlight.set(key, pending)
  try {
    return await pending
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key)
  }
}
