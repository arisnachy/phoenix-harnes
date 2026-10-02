/** Native Codex-session token bridge for the OpenAI Codex LLM route.
 *
 * PHOENIX never consults OPENAI_API_KEY for `openai-codex`. Instead it asks
 * the locally authenticated Codex app-server for its current ChatGPT access
 * token, requests a refresh through Codex when needed, keeps the token only in
 * process memory, and lets Codex remain the credential authority.
 *
 * @module dsh-llm-pi-ai/codex-auth
 */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { LlmError } from '@phoenix-ai/dsh-llm'
import {
  codexDiscoveryArgs,
  codexEnvironment,
  encodeCodexWireFrame,
  finishProcessSetup,
  terminateCodexProcess,
} from './codex-discovery.ts'
import { isChatGptAccountJwt } from './codex-platform.ts'

const RPC_TIMEOUT_MS = 20_000
const MAX_CACHE_MS = 10 * 60_000
const EXPIRY_SAFETY_MS = 5 * 60_000

interface JsonRpcErrorShape {
  readonly code?: unknown
  readonly message?: unknown
}

interface JsonRpcResponseShape {
  readonly id?: unknown
  readonly result?: unknown
  readonly error?: JsonRpcErrorShape | null
}

interface CodexAuthStatusShape {
  readonly authMethod?: unknown
  readonly authToken?: unknown
  readonly requiresOpenaiAuth?: unknown
}

/** Injectable transport seam for native Codex auth regression tests. */
export interface CodexNativeAuthTransport {
  read(): Promise<string>
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * Validate the deprecated-but-current Codex getAuthStatus result used solely
 * for token export. The returned token must be ChatGPT OAuth and carry the
 * account claim required by the Codex Responses backend.
 * @param result - raw app-server result.
 * @returns the current ChatGPT access JWT.
 */
export function readCodexNativeAuthStatus(result: unknown): string {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new LlmError('Codex auth status returned no object', 'MISSING_CREDENTIAL')
  }
  const status = result as CodexAuthStatusShape
  const method = text(status.authMethod)
  if (method !== 'chatgpt' && method !== 'chatgpt_auth_tokens') {
    throw new LlmError(
      'Phoenix OpenAI/Codex requires Codex to be logged in with ChatGPT. Run "codex login" and choose ChatGPT authentication.',
      'MISSING_CREDENTIAL',
    )
  }
  const token = text(status.authToken)
  if (token === undefined || !isChatGptAccountJwt(token)) {
    throw new LlmError(
      'Codex is logged in, but it did not expose a usable ChatGPT session token. Re-run "codex login" to refresh the native Codex session.',
      'MISSING_CREDENTIAL',
    )
  }
  return token
}

function codexAuthProcess(): ChildProcessWithoutNullStreams {
  const args = codexDiscoveryArgs()
  const common = {
    cwd: process.cwd(),
    env: codexEnvironment(),
    windowsHide: true,
  }
  if (process.platform === 'win32') {
    const shell = process.env.ComSpec ?? 'cmd.exe'
    return finishProcessSetup(spawn(
      shell,
      ['/d', '/s', '/c', `codex ${args.join(' ')}`],
      common,
    ))
  }
  return finishProcessSetup(spawn('codex', args, common))
}

async function nextResponse(
  iterator: AsyncIterator<string>,
  expectedId: number,
): Promise<unknown> {
  for (;;) {
    const line = await new Promise<IteratorResult<string>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new LlmError(
          'Codex app-server timed out while reading native authentication',
          'MISSING_CREDENTIAL',
        ))
      }, RPC_TIMEOUT_MS)
      void iterator.next().then(resolve, reject).finally(() => { clearTimeout(timer) })
    })
    if (line.done) {
      throw new LlmError(
        'Codex app-server closed before native authentication completed',
        'MISSING_CREDENTIAL',
      )
    }
    const source = line.value.trim()
    if (source === '') continue
    let message: JsonRpcResponseShape
    try {
      message = JSON.parse(source) as JsonRpcResponseShape
    } catch (error: unknown) {
      throw new LlmError('Codex app-server returned invalid auth JSON', 'MISSING_CREDENTIAL', { cause: error })
    }
    if (message.id === undefined) continue
    if (message.id !== expectedId) {
      throw new LlmError(
        `Codex auth response id mismatch: expected ${expectedId}, received ${typeof message.id === 'string' || typeof message.id === 'number' ? message.id : 'unknown'}`,
        'MISSING_CREDENTIAL',
      )
    }
    if (message.error !== undefined && message.error !== null) {
      const detail = text(message.error.message) ?? `RPC error ${typeof message.error.code === 'string' || typeof message.error.code === 'number' ? message.error.code : 'unknown'}`
      throw new LlmError(`Codex native authentication failed: ${detail}`, 'MISSING_CREDENTIAL')
    }
    return message.result
  }
}

async function readFromCodex(): Promise<string> {
  const child = codexAuthProcess()
  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY })
  const iterator = lines[Symbol.asyncIterator]()
  try {
    child.stdin.write(encodeCodexWireFrame({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'phoenix-native-codex-auth', version: '0.1.1' },
        capabilities: { experimentalApi: true },
      },
    }))
    await nextResponse(iterator, 1)
    child.stdin.write(encodeCodexWireFrame({ method: 'initialized' }))
    child.stdin.write(encodeCodexWireFrame({
      id: 2,
      method: 'getAuthStatus',
      params: { includeToken: true, refreshToken: true },
    }))
    return readCodexNativeAuthStatus(await nextResponse(iterator, 2))
  } finally {
    terminateCodexProcess(child, lines)
  }
}

export const codexNativeAuthTransport: CodexNativeAuthTransport = {
  read: readFromCodex,
}

interface CachedToken {
  readonly token: string
  readonly until: number
}

let cached: CachedToken | undefined
let pending: Promise<string> | undefined

function cacheUntil(token: string): number {
  const now = Date.now()
  let jwtExpiry = now + MAX_CACHE_MS
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: unknown }
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) jwtExpiry = payload.exp * 1000
  } catch {
    // readCodexNativeAuthStatus already validated the JWT; a malformed exp only shortens caching.
  }
  return Math.max(now, Math.min(now + MAX_CACHE_MS, jwtExpiry - EXPIRY_SAFETY_MS))
}

/**
 * Resolve the OpenAI Codex credential from Codex itself, never from an API-key
 * environment variable. Concurrent turns share one refresh probe and the
 * returned token remains memory-only.
 * @param transport - injectable native-auth source for deterministic tests.
 * @returns a ChatGPT OAuth JWT suitable for the Codex Responses wire.
 */
export async function codexNativeAccessToken(
  transport: CodexNativeAuthTransport = codexNativeAuthTransport,
): Promise<string> {
  const now = Date.now()
  if (transport === codexNativeAuthTransport && cached !== undefined && cached.until > now) return cached.token
  if (transport === codexNativeAuthTransport && pending !== undefined) return pending
  const task = transport.read().then((token) => {
    if (transport === codexNativeAuthTransport) cached = { token, until: cacheUntil(token) }
    return token
  })
  if (transport !== codexNativeAuthTransport) return task
  pending = task
  try {
    return await task
  } finally {
    if (pending === task) pending = undefined
  }
}

/** Test-only cache reset exported to keep module-level auth state deterministic. */
export function resetCodexNativeAuthCache(): void {
  cached = undefined
  pending = undefined
}
