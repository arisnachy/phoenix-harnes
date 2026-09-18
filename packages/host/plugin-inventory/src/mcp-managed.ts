import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { withFileLock, writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import { searchOfficialMcpRegistry } from './mcp-registry.ts'
import type {
  ManagedMcpConnector,
  McpRegistryCandidate,
  McpRegistryInstallReceipt,
  McpRegistryInstallRequest,
  McpRegistrySearchSnapshot,
} from './types.ts'

const MCP_CLIENT_PACKAGE = '@phoenix-ai/dsh-mcp-client'
const MANAGED_PATCH_FILE = dshHomePath('mcp', 'managed.patch.yml')
const SERVER_NAME_MAX = 32

interface ManagedMcpConfig {
  transport: 'streamable-http'
  serverName: string
  url: string
  headers: Record<string, string>
  oauth: true
}

interface ManagedMcpRow {
  id: string
  name: typeof MCP_CLIENT_PACKAGE
  config: ManagedMcpConfig
}

interface ManagedMcpPatch {
  insert: ManagedMcpRow[]
}

/** Minimal Loader mutation seam needed for immediate MCP activation and rollback. */
export interface ManagedMcpLoader {
  create(options: { name: string; config: ManagedMcpConfig }): Promise<string>
  remove(id: string): Promise<void>
}

/** Injectable registry lookup used to re-verify a browser/model install request Host-side. */
export type ManagedMcpRegistrySearch = (
  request: { query: string; limit?: number },
) => Promise<McpRegistrySearchSnapshot>

/** Optional construction seams used by tests and alternate host embeddings. */
export interface ManagedMcpControllerOptions {
  readonly patchPath?: string
  readonly registrySearch?: ManagedMcpRegistrySearch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validConfig(value: unknown): value is ManagedMcpConfig {
  if (!isRecord(value)) return false
  if (value.transport !== 'streamable-http' || typeof value.serverName !== 'string'
    || typeof value.url !== 'string' || value.oauth !== true) return false
  if (!isRecord(value.headers) || Object.keys(value.headers).length !== 0) return false
  try {
    return new URL(value.url).protocol === 'https:'
  } catch {
    return false
  }
}

function parseManagedRows(raw: string): ManagedMcpRow[] {
  const document: unknown = JSON.parse(raw)
  if (!Array.isArray(document) || document.length !== 1) {
    throw new Error('managed MCP patch must contain exactly one insert document')
  }
  const patch = document[0]
  if (!isRecord(patch) || !Array.isArray(patch.insert)) {
    throw new Error('managed MCP patch is missing its insert list')
  }
  return patch.insert.map((value, index) => {
    if (!isRecord(value) || typeof value.id !== 'string' || value.name !== MCP_CLIENT_PACKAGE || !validConfig(value.config)) {
      throw new Error(`managed MCP patch row ${index} is invalid`)
    }
    return {
      id: value.id,
      name: MCP_CLIENT_PACKAGE,
      config: value.config,
    }
  })
}

function renderManagedRows(rows: readonly ManagedMcpRow[]): string {
  const document: ManagedMcpPatch[] = [{ insert: [...rows] }]
  return `${JSON.stringify(document, null, 2)}\n`
}

async function readManagedRows(path: string): Promise<ManagedMcpRow[]> {
  try {
    return parseManagedRows(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeManagedRows(path: string, rows: readonly ManagedMcpRow[]): Promise<void> {
  await writeFileAtomic(path, renderManagedRows(rows), { mode: 0o600, dirMode: 0o700 })
}

function connectorOf(row: ManagedMcpRow): ManagedMcpConnector {
  return {
    entryId: row.id,
    serverName: row.config.serverName,
    url: row.config.url,
  }
}

function serverNameFor(candidate: McpRegistryCandidate): string {
  const tail = candidate.name.slice(candidate.name.lastIndexOf('/') + 1)
  const base = tail.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'mcp'
  const digest = createHash('sha256').update(candidate.name).digest('hex').slice(0, 7)
  const maxBase = SERVER_NAME_MAX - digest.length - 1
  return `${base.slice(0, maxBase)}-${digest}`
}

function selectInstallableCandidate(
  snapshot: McpRegistrySearchSnapshot,
  request: McpRegistryInstallRequest,
): McpRegistryCandidate {
  const candidate = snapshot.candidates.find(value =>
    value.name === request.name && (request.version === undefined || value.version === request.version))
  if (candidate === undefined) {
    throw new Error('MCP registry candidate changed or is no longer available; search again before installing')
  }
  if (candidate.status !== 'active') {
    throw new Error(`MCP registry candidate ${candidate.name} is not active`)
  }
  if (candidate.remoteUrl === undefined) {
    throw new Error('Only registry-listed Streamable HTTP MCP servers can be installed automatically; review package-based servers manually')
  }
  return candidate
}

/**
 * Host-owned installer for safe remote MCPs. Every install is re-resolved from
 * the Official MCP Registry, activates the existing PHOENIX MCP client, then
 * persists the exact loader row in a generated owner-private overlay.
 */
export class ManagedMcpController {
  private readonly path: string
  private readonly registrySearch: ManagedMcpRegistrySearch

  /**
   * @param loader - Live Loader used for immediate activation and rollback.
   * @param options - Optional patch path and registry lookup overrides.
   */
  constructor(
    private readonly loader: ManagedMcpLoader,
    options: ManagedMcpControllerOptions = {},
  ) {
    this.path = options.patchPath ?? MANAGED_PATCH_FILE
    this.registrySearch = options.registrySearch ?? searchOfficialMcpRegistry
  }

  /**
   * List PHOENIX-managed MCPs without exposing headers or credentials.
   * @returns Persisted managed connector identities and endpoints.
   */
  async snapshot(): Promise<readonly ManagedMcpConnector[]> {
    return (await readManagedRows(this.path)).map(connectorOf)
  }

  /**
   * Install one exact active registry candidate with a concrete HTTPS remote.
   * The request never supplies an executable command or URL; the Host rechecks
   * both against registry metadata before mutating the Loader.
   * @param request - Registry name and optional exact version selected by the user/model.
   * @returns Idempotent installation receipt.
   */
  async install(request: McpRegistryInstallRequest): Promise<McpRegistryInstallReceipt> {
    const name = request.name.trim()
    if (name.length < 2) throw new Error('MCP registry install requires a valid server name')
    const snapshot = await this.registrySearch({ query: name, limit: 20 })
    const candidate = selectInstallableCandidate(snapshot, { ...request, name })
    const serverName = serverNameFor(candidate)
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })

    return withFileLock(this.path, async () => {
      const rows = await readManagedRows(this.path)
      const existing = rows.find(row => row.config.url === candidate.remoteUrl)
      if (existing !== undefined) {
        return { status: 'already-installed', connector: connectorOf(existing) }
      }

      const config: ManagedMcpConfig = {
        transport: 'streamable-http',
        serverName,
        url: candidate.remoteUrl!,
        headers: {},
        oauth: true,
      }
      const entryId = await this.loader.create({ name: MCP_CLIENT_PACKAGE, config })
      const row: ManagedMcpRow = { id: entryId, name: MCP_CLIENT_PACKAGE, config }
      try {
        await writeManagedRows(this.path, [...rows, row])
      } catch (error) {
        try {
          await this.loader.remove(entryId)
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'failed to persist managed MCP and roll back live activation')
        }
        throw error
      }
      return { status: 'installed', connector: connectorOf(row) }
    }, { waitMs: 15_000 })
  }
}

/**
 * Path to the generated MCP overlay consumed by the PHOENIX launcher.
 * @returns Absolute managed overlay path under DSH_HOME.
 */
export function managedMcpPatchPath(): string {
  return MANAGED_PATCH_FILE
}
