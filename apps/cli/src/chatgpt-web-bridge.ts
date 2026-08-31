/**
 * Lifecycle controller for an explicitly configured local ChatGPT Web bridge.
 * The bridge owns browser authentication; PHOENIX only starts its argv,
 * checks its loopback Responses endpoint, and records process ownership.
 * @module @phoenix-ai/dsh/chatgpt-web-bridge
 */

import { readFile, rm } from 'node:fs/promises'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'

/** Default endpoint exposed by the local `codex-chatgpt-web` bridge. */
export const DEFAULT_CHATGPT_WEB_URL = 'http://127.0.0.1:17841/v1'

/** The persisted ownership record format. */
export interface ChatGptWebBridgeState {
  readonly schema: 1
  readonly pid: number
  readonly baseUrl: string
}

/** Configuration needed to start one local bridge process. */
export interface ChatGptWebBridgeConfig {
  readonly baseUrl: string
  readonly command?: readonly [string, ...string[]]
  readonly cwd?: string
}

/** Public bridge status used by the CLI and future settings surfaces. */
export type ChatGptWebBridgeStatus =
  | { readonly status: 'stopped' }
  | { readonly status: 'starting' | 'unavailable'; readonly pid?: number; readonly baseUrl: string; readonly detail: string }
  | { readonly status: 'ready'; readonly pid?: number; readonly baseUrl: string; readonly detail: string }

interface BridgeProcess {
  readonly pid?: number
  on(event: 'error', listener: (error: Error) => void): this
  unref(): void
}

interface BridgeDependencies {
  readonly statePath: string
  readonly config: ChatGptWebBridgeConfig
  readonly spawn?: (program: string, args: readonly string[], options: {
    readonly cwd?: string
    readonly detached: true
    readonly stdio: 'ignore'
    readonly windowsHide: true
    readonly env: NodeJS.ProcessEnv
  }) => BridgeProcess
  readonly fetch?: typeof fetch
  readonly readProcess?: (pid: number) => boolean
  readonly kill?: (pid: number) => void
}

/** Parse the only accepted command format: a JSON argv array, never a shell string. */
export function parseChatGptWebCommand(value: string | undefined): readonly [string, ...string[]] | undefined {
  if (value === undefined || value.trim() === '') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('PHOENIX_CHATGPT_WEB_COMMAND must be a JSON array of argv strings')
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some(item => typeof item !== 'string' || item.trim() === '')) {
    throw new Error('PHOENIX_CHATGPT_WEB_COMMAND must be a non-empty JSON array of argv strings')
  }
  return parsed as [string, ...string[]]
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

/** Resolve environment configuration and reject endpoints that could expose credentials. */
export function resolveChatGptWebConfig(env: NodeJS.ProcessEnv = process.env): ChatGptWebBridgeConfig {
  const baseUrl = (env.PHOENIX_CHATGPT_WEB_URL?.trim() || DEFAULT_CHATGPT_WEB_URL)
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('PHOENIX_CHATGPT_WEB_URL must be a valid loopback URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !isLoopback(parsed.hostname)
    || parsed.username !== '' || parsed.password !== '') {
    throw new Error('PHOENIX_CHATGPT_WEB_URL must use a loopback URL without embedded credentials')
  }
  const command = parseChatGptWebCommand(env.PHOENIX_CHATGPT_WEB_COMMAND)
  const cwd = env.PHOENIX_CHATGPT_WEB_CWD?.trim()
  return {
    baseUrl,
    ...(command === undefined ? {} : { command }),
    ...(cwd === undefined || cwd === '' ? {} : { cwd }),
  }
}

function modelCount(body: string): number {
  try {
    const value: unknown = JSON.parse(body)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return 0
    const models = (value as { models?: unknown; data?: unknown }).models
      ?? (value as { models?: unknown; data?: unknown }).data
    return Array.isArray(models)
      ? models.filter(model => model !== null && typeof model === 'object'
        && typeof (model as { id?: unknown }).id === 'string'
        && (model as { id: string }).id.length > 0).length
      : 0
  } catch {
    return 0
  }
}

/** Validate one sanitized bridge response for doctor and lifecycle callers. */
export function inspectChatGptWebHealth(status: number, body: string): { ok: boolean; detail: string } {
  if (status < 200 || status >= 300) return { ok: false, detail: `ChatGPT Web bridge returned HTTP ${String(status)}` }
  const count = modelCount(body)
  return count > 0
    ? { ok: true, detail: `ChatGPT Web bridge is healthy (${String(count)} model${count === 1 ? '' : 's'} available)` }
    : { ok: false, detail: 'ChatGPT Web bridge returned no usable models' }
}

/** Manage one user-configured loopback bridge without handling its credentials. */
export class ChatGptWebBridge {
  private readonly dependencies: BridgeDependencies

  /**
   * @param dependencies - filesystem, process, and network seams for one bridge.
   */
  constructor(dependencies: BridgeDependencies) {
    this.dependencies = dependencies
  }

  /** Persist ownership after a process has been spawned successfully. */
  async writeOwnedState(pid: number): Promise<void> {
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('ChatGPT Web bridge returned an invalid process id')
    const state: ChatGptWebBridgeState = { schema: 1, pid, baseUrl: this.dependencies.config.baseUrl }
    await writeFileAtomic(this.dependencies.statePath, `${JSON.stringify(state)}\n`, { mode: 0o600, dirMode: 0o700 })
  }

  private async readOwnedState(): Promise<ChatGptWebBridgeState | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(this.dependencies.statePath, 'utf8'))
      if (value === null || typeof value !== 'object' || (value as { schema?: unknown }).schema !== 1
        || !Number.isSafeInteger((value as { pid?: unknown }).pid)
        || typeof (value as { baseUrl?: unknown }).baseUrl !== 'string') {
        throw new Error('ChatGPT Web bridge state is invalid')
      }
      return value as ChatGptWebBridgeState
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  private processIsRunning(pid: number): boolean {
    if (this.dependencies.readProcess !== undefined) return this.dependencies.readProcess(pid)
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  /** Start the configured argv without a shell and record only non-secret ownership data. */
  async start(): Promise<ChatGptWebBridgeStatus> {
    const command = this.dependencies.config.command
    if (command === undefined) throw new Error('ChatGPT Web bridge is not configured; set PHOENIX_CHATGPT_WEB_COMMAND to a JSON argv array')
    const previous = await this.readOwnedState()
    if (previous !== undefined && this.processIsRunning(previous.pid)) {
      return { status: 'starting', pid: previous.pid, baseUrl: previous.baseUrl, detail: 'ChatGPT Web bridge is already running' }
    }
    const [program, ...args] = command
    const child = (this.dependencies.spawn ?? defaultSpawn)(program, args, {
      ...(this.dependencies.config.cwd === undefined ? {} : { cwd: this.dependencies.config.cwd }),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, PHOENIX_CHATGPT_WEB_URL: this.dependencies.config.baseUrl },
    })
    const pid = child.pid
    if (pid === undefined) throw new Error('ChatGPT Web bridge did not return a process id')
    await this.writeOwnedState(pid)
    child.on('error', () => { void rm(this.dependencies.statePath, { force: true }) })
    child.unref()
    return { status: 'starting', pid, baseUrl: this.dependencies.config.baseUrl, detail: 'ChatGPT Web bridge is starting' }
  }

  /** Query the loopback `/v1/models` endpoint without exposing the response body. */
  async status(): Promise<ChatGptWebBridgeStatus> {
    const owned = await this.readOwnedState()
    const baseUrl = owned?.baseUrl ?? this.dependencies.config.baseUrl
    const pid = owned?.pid
    if (owned !== undefined && !this.processIsRunning(owned.pid)) {
      await rm(this.dependencies.statePath, { force: true })
      return { status: 'stopped' }
    }
    try {
      const response = await (this.dependencies.fetch ?? fetch)(new URL('/v1/models', baseUrl), { signal: AbortSignal.timeout(1500) })
      const body = await response.text()
      const health = inspectChatGptWebHealth(response.status, body)
      if (health.ok) {
        const count = modelCount(body)
        return { status: 'ready', ...(pid === undefined ? {} : { pid }), baseUrl, detail: `${String(count)} model${count === 1 ? '' : 's'} available` }
      }
      return { status: owned === undefined ? 'unavailable' : 'starting', ...(pid === undefined ? {} : { pid }), baseUrl, detail: health.detail }
    } catch {
      return { status: owned === undefined ? 'unavailable' : 'starting', ...(pid === undefined ? {} : { pid }), baseUrl, detail: 'ChatGPT Web bridge is unreachable' }
    }
  }

  /** Stop only the process recorded by this controller and remove its ownership record. */
  async stop(): Promise<{ readonly status: 'stopped' }> {
    const owned = await this.readOwnedState()
    if (owned !== undefined && this.processIsRunning(owned.pid)) {
      try {
        (this.dependencies.kill ?? defaultKill)(owned.pid)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    await rm(this.dependencies.statePath, { force: true })
    return { status: 'stopped' }
  }
}

function defaultSpawn(program: string, args: readonly string[], options: Parameters<typeof nodeSpawn>[2]): ChildProcess {
  return nodeSpawn(program, args, options)
}

function defaultKill(pid: number): void {
  process.kill(pid)
}

function statePath(): string {
  return dshHomePath('integrations', 'chatgpt-web-bridge.json')
}

/** Run the `dsh chatgpt-web` lifecycle command. */
export async function runChatGptWebBridge(args: readonly string[]): Promise<number> {
  if (args.length > 1 || (args[0] !== undefined && !['start', 'status', 'stop', '--help', '-h'].includes(args[0]))) {
    process.stderr.write('error: chatgpt-web accepts only start, status, or stop\n')
    return 1
  }
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write('Usage: dsh chatgpt-web <start|status|stop>\n\nSet PHOENIX_CHATGPT_WEB_COMMAND to a JSON argv array to enable start.\n')
    return 0
  }
  try {
    const controller = new ChatGptWebBridge({ statePath: statePath(), config: resolveChatGptWebConfig() })
    const result = args[0] === 'start' ? await controller.start()
      : args[0] === 'stop' ? await controller.stop() : await controller.status()
    process.stdout.write(`ChatGPT Web bridge: ${result.status}${'detail' in result ? ` — ${result.detail}` : ''}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
