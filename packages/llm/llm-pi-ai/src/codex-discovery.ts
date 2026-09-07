/**
 * Live model discovery for the ChatGPT-authenticated Codex route.
 *
 * Codex owns account-scoped model availability. Its app-server `model/list`
 * request is therefore the authority for the Models settings picker; the
 * bundled pi-ai catalog is intentionally not used as a fallback here.
 *
 * @module dsh-llm-pi-ai/codex-discovery
 */

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Interface as ReadlineInterface } from 'node:readline'
import { LlmError } from '@phoenix-ai/dsh-llm'
import type { LlmDiscoveredModel } from '@phoenix-ai/dsh-llm'

const RPC_TIMEOUT_MS = 20_000
const PAGE_LIMIT = 100
const MAX_PAGES = 50

interface JsonRpcErrorShape {
  code?: unknown
  message?: unknown
}

interface JsonRpcResponseShape {
  id?: unknown
  result?: unknown
  error?: JsonRpcErrorShape | null
}

interface CodexModelShape {
  id?: unknown
  model?: unknown
  displayName?: unknown
  hidden?: unknown
}

interface CodexModelListShape {
  data?: unknown
  nextCursor?: unknown
}

/** Injectable transport seam used by regression tests. */
export interface CodexModelListTransport {
  list(signal?: AbortSignal): Promise<readonly LlmDiscoveredModel[]>
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Map one app-server `model/list` result into PHOENIX discovery rows.
 * The `model` field is the value Codex actually sends to turns; `id` is only a
 * compatibility fallback for older app-server builds.
 */
export function readCodexModelPage(result: unknown): {
  models: LlmDiscoveredModel[]
  nextCursor?: string
} {
  const page = result as CodexModelListShape | null
  if (!Array.isArray(page?.data)) {
    throw new LlmError('Codex model/list returned no data array', 'DISCOVERY_FAILED')
  }
  const models: LlmDiscoveredModel[] = []
  for (const raw of page.data) {
    const entry = raw as CodexModelShape | null
    if (entry?.hidden === true) continue
    const id = text(entry?.model) ?? text(entry?.id)
    if (id === undefined) continue
    const name = text(entry?.displayName)
    models.push({ id, ...name === undefined ? {} : { name } })
  }
  const nextCursor = text(page.nextCursor)
  return { models, ...nextCursor === undefined ? {} : { nextCursor } }
}

/** Only the ambient facts Codex needs to find its install, config and network. */
function codexEnvironment(): NodeJS.ProcessEnv {
  const names = [
    'PATH', 'Path', 'PATHEXT', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
    'CODEX_HOME', 'XDG_CONFIG_HOME', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP',
    'LANG', 'LC_ALL', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
    'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  ] as const
  const env: NodeJS.ProcessEnv = {}
  for (const name of names) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

function codexProcess(signal?: AbortSignal): ChildProcessWithoutNullStreams {
  const common = {
    cwd: process.cwd(),
    env: codexEnvironment(),
    windowsHide: true,
    signal,
  }
  if (process.platform === 'win32') {
    const shell = process.env.ComSpec ?? 'cmd.exe'
    // Fixed command text only: no user-controlled value crosses cmd.exe.
    return spawn(shell, ['/d', '/s', '/c', 'codex app-server --listen stdio://'], common)
  }
  return spawn('codex', ['app-server', '--listen', 'stdio://'], common)
}

function writeFrame(child: ChildProcessWithoutNullStreams, frame: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    child.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
      if (error === null || error === undefined) resolve()
      else reject(error)
    })
  })
}

async function nextLine(
  iterator: AsyncIterator<string>,
  signal: AbortSignal | undefined,
): Promise<IteratorResult<string>> {
  if (signal?.aborted) throw new LlmError('Codex model discovery aborted by caller', 'ABORTED')
  return await new Promise<IteratorResult<string>>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new LlmError('Codex app-server timed out while listing models', 'DISCOVERY_FAILED'))
    }, RPC_TIMEOUT_MS)
    const aborted = (): void => {
      reject(new LlmError('Codex model discovery aborted by caller', 'ABORTED'))
    }
    signal?.addEventListener('abort', aborted, { once: true })
    iterator.next().then(resolve, reject).finally(() => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
    })
  })
}

async function readResponse(
  iterator: AsyncIterator<string>,
  expectedId: number,
  signal?: AbortSignal,
): Promise<unknown> {
  for (;;) {
    const line = await nextLine(iterator, signal)
    if (line.done) {
      throw new LlmError('Codex app-server closed before model discovery completed', 'DISCOVERY_FAILED')
    }
    const source = line.value.trim()
    if (source.length === 0) continue
    let message: JsonRpcResponseShape
    try {
      message = JSON.parse(source) as JsonRpcResponseShape
    } catch (error: unknown) {
      throw new LlmError('Codex app-server returned invalid JSON', 'DISCOVERY_FAILED', { cause: error })
    }
    // Notifications have no id and may arrive between responses.
    if (message.id === undefined) continue
    if (message.id !== expectedId) {
      throw new LlmError(
        `Codex app-server response id mismatch: expected ${expectedId}, received ${String(message.id)}`,
        'DISCOVERY_FAILED',
      )
    }
    if (message.error !== undefined && message.error !== null) {
      const detail = text(message.error.message) ?? `RPC error ${String(message.error.code ?? 'unknown')}`
      throw new LlmError(`Codex model/list failed: ${detail}`, 'DISCOVERY_FAILED')
    }
    return message.result
  }
}

async function terminate(child: ChildProcessWithoutNullStreams, lines: ReadlineInterface): Promise<void> {
  lines.close()
  child.stdin.end()
  if (child.exitCode === null && child.signalCode === null) child.kill()
}

/**
 * Ask the locally authenticated Codex installation for the account-visible
 * model catalog. The handshake follows app-server protocol ordering exactly:
 * initialize response, initialized notification, then model/list requests.
 */
export async function listCodexModels(signal?: AbortSignal): Promise<readonly LlmDiscoveredModel[]> {
  let child: ChildProcessWithoutNullStreams
  try {
    child = codexProcess(signal)
  } catch (error: unknown) {
    throw new LlmError('Could not start the Codex CLI for model discovery', 'DISCOVERY_FAILED', { cause: error })
  }
  const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY })
  const iterator = lines[Symbol.asyncIterator]()
  const models = new Map<string, LlmDiscoveredModel>()
  let requestId = 1
  try {
    await writeFrame(child, {
      id: requestId,
      method: 'initialize',
      params: {
        clientInfo: { name: 'phoenix-harness', version: '0.1.1' },
        capabilities: { experimentalApi: true },
      },
    })
    await readResponse(iterator, requestId, signal)
    await writeFrame(child, { method: 'initialized' })

    let cursor: string | undefined
    for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
      requestId += 1
      await writeFrame(child, {
        id: requestId,
        method: 'model/list',
        params: {
          cursor: cursor ?? null,
          limit: PAGE_LIMIT,
          includeHidden: false,
        },
      })
      const page = readCodexModelPage(await readResponse(iterator, requestId, signal))
      for (const model of page.models) models.set(model.id, model)
      cursor = page.nextCursor
      if (cursor === undefined) return [...models.values()]
    }
    throw new LlmError(
      `Codex model/list exceeded ${MAX_PAGES} pages; refusing a partial catalog`,
      'DISCOVERY_FAILED',
    )
  } catch (error: unknown) {
    if (signal?.aborted) {
      throw new LlmError('Codex model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    if (error instanceof LlmError) throw error
    throw new LlmError('Codex model discovery failed', 'DISCOVERY_FAILED', { cause: error })
  } finally {
    await terminate(child, lines)
  }
}

/** Production transport exposed separately so discovery.ts can inject a fake in tests. */
export const codexModelListTransport: CodexModelListTransport = { list: listCodexModels }
