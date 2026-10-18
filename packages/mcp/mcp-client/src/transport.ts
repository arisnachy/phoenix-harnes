/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@phoenix-ai/dsh-subprocess'
import type { Config } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/** Opt-in Python hook loaded only by Phoenix's curated Fetch MCP on Windows. */
const FETCH_MCP_NPM_SITE_FILE = fileURLToPath(
  new URL('../../../../scripts/phoenix-fetch-mcp-sitecustomize/sitecustomize.py', import.meta.url),
)


/**
 * The curated Python Fetch MCP uses readabilipy, which launches Node and npm
 * for Readability.js. Long-running Phoenix Windows Hosts can inherit a PATH
 * without the Node installation even while process.execPath works.
 *
 * Admit only a verified local Node + npm installation. This deliberately does
 * not install packages, change system PATH, or alter other/user MCP servers.
 * @param config - MCP transport metadata identifying the curated Fetch server.
 * @param environment - Sanitized environment for its child process.
 * @param options - Injectable platform and filesystem probes.
 * @returns Safe environment with verified local Node tooling when available.
 */
export function hydrateFetchMcpNodeEnvironment(
  config: { readonly serverName: string; readonly command: string; readonly args: readonly string[] },
  environment: Readonly<Record<string, string>>,
  options: {
    readonly platform?: NodeJS.Platform
    readonly nodeExecutable?: string
    readonly fileExists?: (path: string) => boolean
  } = {},
): Record<string, string> {
  const result = { ...environment }
  if ((options.platform ?? process.platform) !== 'win32'
    || config.serverName !== 'fetch'
    || !/^uvx(?:\.exe)?$/iu.test(win32.basename(config.command))
    || config.args[0] !== 'mcp-server-fetch') return result

  const exists = options.fileExists ?? existsSync
  // A Windows stdio child must not receive both Path and PATH. The last
  // spelling is the explicit config override after the scrubbed parent merge.
  const pathKeys = Object.keys(result).filter(item => item.toUpperCase() === 'PATH')
  const key = pathKeys.at(-1) ?? 'Path'
  const current = result[key] ?? ''
  for (const alias of pathKeys) if (alias !== key) delete result[alias]
  const validDirectory = (directory: string): boolean => {
    if (!win32.isAbsolute(directory) || !exists(win32.join(directory, 'node.exe'))) return false
    return exists(win32.join(directory, 'npm.cmd')) || exists(win32.join(directory, 'npm.exe'))
  }

  // Keep the user's verified Node installation; detect npm.cmd as well as
  // npm.exe because Windows Python subprocesses cannot reliably resolve the
  // bare "npm" name to npm.cmd even when its directory is already on PATH.
  const present = current.split(';').map(entry => entry.replace(/^"(.*)"$/u, '$1').trim())
  const presentDirectory = present.find(validDirectory)
  const node = options.nodeExecutable ?? process.execPath
  const localAppData = Object.entries(result).find(([name]) => name.toUpperCase() === 'LOCALAPPDATA')?.[1]
  const programFiles = Object.entries(result).find(([name]) => name.toUpperCase() === 'PROGRAMFILES')?.[1]
  const x86ProgramFiles = Object.entries(result).find(([name]) => name.toUpperCase() === 'PROGRAMFILES(X86)')?.[1]
  const nvmLink = Object.entries(result).find(([name]) => name.toUpperCase() === 'NVM_SYMLINK')?.[1]
  const candidates = [
    win32.dirname(node),
    nvmLink,
    programFiles === undefined ? undefined : win32.join(programFiles, 'nodejs'),
    x86ProgramFiles === undefined ? undefined : win32.join(x86ProgramFiles, 'nodejs'),
    localAppData === undefined ? undefined : win32.join(localAppData, 'Programs', 'nodejs'),
  ]
  const directory = presentDirectory ?? candidates.find(value => value !== undefined && validDirectory(value))
  if (directory === undefined) return result // No installation to pretend is working.
  if (presentDirectory === undefined) result[key] = current === '' ? directory : `${directory};${current}`

  // ReadabiliPy calls subprocess(["npm", "version"]) and ["npm", "install"]
  // inside uvx's Python child. Its bare executable lookup is unreliable for
  // Windows npm.cmd, irrespective of a valid PATH. A Fetch-only sitecustomize
  // fixes that invocation and keeps first-use npm output off JSON-RPC stdout.
  if (exists(FETCH_MCP_NPM_SITE_FILE)) {
    const pythonKeys = Object.keys(result).filter(name => name.toUpperCase() === 'PYTHONPATH')
    const pythonKey = pythonKeys.at(-1) ?? 'PYTHONPATH'
    const pythonPath = result[pythonKey] ?? ''
    for (const alias of pythonKeys) if (alias !== pythonKey) delete result[alias]
    const siteDirectory = dirname(FETCH_MCP_NPM_SITE_FILE)
    const segments = pythonPath.split(';').map(value => value.replace(/^"(.*)"$/u, '$1').trim())
    result[pythonKey] = segments.some(value => value.toLowerCase() === siteDirectory.toLowerCase())
      ? pythonPath
      : pythonPath === '' ? siteDirectory : `${siteDirectory};${pythonPath}`
    result.PHOENIX_FETCH_MCP_NPM_SHIM = '1'
  }
  return result
}

type SdkStdioChild = {
  stdin?: {
    on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown
  } | null
}

function isExpectedStdioPipeClose(error: NodeJS.ErrnoException): boolean {
  return error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED'
}

/**
 * MCP SDK stdio transport with a parent-side writable error owner.
 *
 * A short-lived server can exit after the SDK spawns it but before or during
 * the first JSON-RPC write. On Node/Windows that broken child stdin is a Socket
 * whose unhandled `error` event would otherwise terminate the whole PHOENIX
 * Host. The SDK still owns protocol failure/close; this shim only contains the
 * stream event and forwards unexpected pipe errors through Transport.onerror.
 */
class PhoenixStdioClientTransport extends StdioClientTransport {
  override start(): Promise<void> {
    const started = super.start()
    // @modelcontextprotocol/sdk currently stores the spawned child on
    // `_process`. Attach immediately after synchronous spawn, before the
    // Client can send initialize. The cast is intentionally isolated here so a
    // future SDK layout change fails the focused regression test, not silently.
    const child = (this as unknown as { _process?: SdkStdioChild })._process
    child?.stdin?.on('error', (error) => {
      if (isExpectedStdioPipeClose(error)) return
      this.onerror?.(error)
    })
    return started
  }
}

const CURRENT_PHOENIX_STDIO_PROXY = fileURLToPath(
  new URL('../../../../scripts/mcp-stdio-proxy.mjs', import.meta.url),
)

/** Never persist a staging-specific absolute path to the personal Microsoft MCP. */
const CURRENT_MICROSOFT_PERSONAL_MCP = fileURLToPath(
  new URL('../../../../scripts/phoenix-microsoft-personal-mcp.mjs', import.meta.url),
)

/** Resolve the optional local Graph MCP from the active Phoenix runtime, not process.cwd(). */
export function normalizeMicrosoftPersonalMcpLaunch(
  serverName: string, command: string, args: readonly string[],
): { command: string; args: string[] } {
  if (serverName === 'microsoft-personal'
    && command === 'node'
    && args.length === 1
    && args[0] === 'scripts/phoenix-microsoft-personal-mcp.mjs') {
    if (!existsSync(CURRENT_MICROSOFT_PERSONAL_MCP)) {
      throw new Error('mcp-client: Microsoft Personal MCP script is missing from the active Phoenix runtime')
    }
    return { command: process.execPath, args: [CURRENT_MICROSOFT_PERSONAL_MCP] }
  }
  return normalizeWindowsNpxMcpLaunch(command, args)
}

function isPhoenixStdioProxyPath(value: string): boolean {
  return value.replace(/\\/g, '/').toLowerCase().endsWith('/scripts/mcp-stdio-proxy.mjs')
}

const FILESYSTEM_MCP_PACKAGE = '@modelcontextprotocol/server-filesystem'
const FILESYSTEM_MCP_BIN_NAMES = new Set([
  'mcp-server-filesystem',
  'mcp-server-filesystem.cmd',
])

const WINDOWS_NPX_MCP_PACKAGES = new Set([
  FILESYSTEM_MCP_PACKAGE,
  '@modelcontextprotocol/server-memory',
  '@brave/brave-search-mcp-server',
])

const moduleRequire = createRequire(import.meta.url)

function npxPackageName(args: readonly string[]): string | undefined {
  const packageArg = args[0] === '-y' ? args[1] : undefined
  if (packageArg === undefined) return undefined
  return [...WINDOWS_NPX_MCP_PACKAGES].find(
    packageName => packageArg === packageName || packageArg.startsWith(`${packageName}@`),
  )
}

function bundledFilesystemMcpEntryPoint(): string | undefined {
  // The modern Filesystem MCP package can hide its package.json via "exports".
  // Resolve its public entrypoint FIRST; relying solely on package.json made
  // Windows fall through to an absent mcp-server-filesystem.cmd shim.
  for (const specifier of [
    FILESYSTEM_MCP_PACKAGE,
    `${FILESYSTEM_MCP_PACKAGE}/dist/index.js`,
    `${FILESYSTEM_MCP_PACKAGE}/package.json`,
  ]) {
    try {
      const located = moduleRequire.resolve(specifier)
      const entry = located.endsWith('package.json')
        ? join(dirname(located), 'dist', 'index.js')
        : located
      if (existsSync(entry) && entry.endsWith('.js')) return entry
    } catch {
      // Check the next public/legacy entry; do not assume package exports.
    }
  }
  return undefined
}

/**
 * Normalize PHOENIX-curated NPX MCP launchers for Windows.
 *
 * Filesystem is launched through Node directly whenever its package is already
 * installed with Phoenix. This bypasses npm's generated `mcp-server-filesystem`
 * shim, which can be missing from PATH or fail to resolve on Windows. Legacy
 * persisted configs that name that shim directly are repaired here too.
 *
 * Other allow-listed NPX MCPs retain the `cmd.exe /c npx` wrapper required
 * for npm's Windows command shims. Arbitrary registry commands never gain a
 * command shell through this compatibility path.
 *
 * @param command - Persisted stdio executable.
 * @param args - Persisted stdio arguments.
 * @param platform - Runtime platform, injectable for regression tests.
 * @returns Safe executable and arguments for the current platform.
 */
export function normalizeWindowsNpxMcpLaunch(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  const normalizedArgs = [...args]
  if (platform !== 'win32') return { command, args: normalizedArgs }

  const normalizedCommand = command.toLowerCase()
  if (FILESYSTEM_MCP_BIN_NAMES.has(normalizedCommand)) {
    const entry = bundledFilesystemMcpEntryPoint()
    if (entry !== undefined) return { command: process.execPath, args: [entry, ...normalizedArgs] }
    // Never re-launch a known-missing bare Windows shim. Use the original
    // curated NPX package route when the bundled package is unavailable.
    return {
      command: 'cmd.exe',
      args: ['/d', '/c', 'npx', '-y', FILESYSTEM_MCP_PACKAGE, ...normalizedArgs],
    }
  }

  if (normalizedCommand !== 'npx') return { command, args: normalizedArgs }
  const packageName = npxPackageName(normalizedArgs)
  if (packageName === undefined) return { command, args: normalizedArgs }

  if (packageName === FILESYSTEM_MCP_PACKAGE) {
    const entry = bundledFilesystemMcpEntryPoint()
    if (entry !== undefined) {
      return {
        command: process.execPath,
        args: [entry, ...normalizedArgs.slice(2)],
      }
    }
  }

  return {
    command: 'cmd.exe',
    args: ['/d', '/c', 'npx', ...normalizedArgs],
  }
}

/**
 * Repair only a stale absolute PHOENIX proxy argument left by an older install.
 *
 * Owner-local Cordis/Codex overlays survive a source reinstall by design. If
 * such an overlay captured the previous checkout's absolute proxy path, Node
 * would otherwise keep launching that deleted path forever. Unknown arguments
 * are never rewritten.
 *
 * @param args - Stdio child arguments from persisted connector configuration.
 * @returns Original arguments when already portable, otherwise a copy pointing
 * at this running PHOENIX installation's checked-in proxy.
 */
export function repairPhoenixStdioProxyArgs(args: readonly string[]): string[] {
  const repaired = args.map((argument) => {
    if (!isPhoenixStdioProxyPath(argument) || existsSync(argument)) return argument
    if (!existsSync(CURRENT_PHOENIX_STDIO_PROXY)) return argument
    return CURRENT_PHOENIX_STDIO_PROXY
  })
  return repaired
}

/**
 * Remote MCP endpoints must use TLS. Plain HTTP is accepted only for a local
 * loopback endpoint used by an explicitly local server; credentials in the URL
 * are never accepted.
 */
function validateHttpEndpoint(raw: string): URL {
  let url: URL
  try { url = new URL(raw) } catch (error: unknown) { throw new Error(`mcp-client: invalid HTTP endpoint URL: ${raw}`, { cause: error }) }
  if (url.username || url.password) throw new Error('mcp-client: credentials in MCP endpoint URLs are not allowed')
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('mcp-client: streamable-http endpoints must use https, except loopback http fixtures')
  }
  return url
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export interface TransportOptions {
  /** Optional OAuth provider used by Streamable HTTP servers. */
  authProvider?: OAuthClientProvider
  /** Resolved Bearer token for one transport generation; never persisted in connector config. */
  bearerToken?: string
  /** Resolve a PHOENIX Bearer credential reference when a fresh generation connects. */
  resolveBearerToken?: (ref: string) => Promise<string | undefined>
  /** Resolve a PHOENIX credential reference for one stdio child env slot. */
  resolveCredentialRef?: (ref: string) => Promise<string | undefined>
  /** Already-resolved secret env values for this stdio generation. */
  stdioCredentialEnv?: Record<string, string>
}

/**
 * Normalize a user/environment Bearer value into the token bytes expected by
 * the Authorization header. This accepts the common copy/paste forms
 * "Bearer <token>" and one pair of wrapping quotes without ever logging the
 * resulting secret.
  * @param value - value supplied to this public operation.
  * @returns Result produced by this public operation.
 */
export function normalizeBearerToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  let token = value.trim()
  if (/^Bearer\s+/i.test(token)) token = token.replace(/^Bearer\s+/i, '').trim()
  if (token.length >= 2) {
    const first = token[0]
    const last = token[token.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      token = token.slice(1, -1).trim()
    }
  }
  return token.length === 0 ? undefined : token
}

function credentialRequired(ref: string): Error & { status: number } {
  return Object.assign(
    new Error(`mcp-client: credential reference "${ref}" is not configured`),
    { status: 401 },
  )
}

/**
 * Construct one MCP transport generation from validated plugin configuration.
 * Bearer secrets arrive only through the generation-scoped options object and
 * are copied into request headers without mutating or persisting connector config.
 * @param config - MCP stdio or Streamable HTTP connector configuration.
 * @param options - Optional OAuth provider or already-resolved Bearer token.
 * @returns A fresh MCP client transport ready for one connection generation.
 */
export function createTransport(config: Config, options: TransportOptions = {}): Transport {
  switch (config.transport) {
    case 'stdio': {
      const launch = normalizeMicrosoftPersonalMcpLaunch(
        config.serverName,
        config.command,
        repairPhoenixStdioProxyArgs(config.args),
      )
      return new PhoenixStdioClientTransport({
        command: launch.command,
        args: launch.args,
        env: hydrateFetchMcpNodeEnvironment(config,
          buildChildEnv({ ...config.env, ...options.stdioCredentialEnv })),
        cwd: config.cwd,
      })
    }
    case 'streamable-http': {
      const headers = { ...config.headers }
      if (config.bearerTokenRef !== undefined) {
        const token = normalizeBearerToken(options.bearerToken)
        if (token === undefined) throw credentialRequired(config.bearerTokenRef)
        headers.Authorization = `Bearer ${token}`
      }
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening.
      return new StreamableHTTPClientTransport(
        validateHttpEndpoint(config.url),
        {
          requestInit: { headers },
          ...(options.authProvider === undefined ? {} : { authProvider: options.authProvider }),
        },
      ) as Transport
    }
  }
}
