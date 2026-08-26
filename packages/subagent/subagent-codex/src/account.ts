/**
 * Native Codex account plane over the official app-server protocol.
 *
 * PHOENIX never parses or stores ChatGPT access/refresh tokens. Codex owns its
 * managed ChatGPT login, persistence and refresh lifecycle; the harness stores
 * only a secret-free credential marker so its generic authorization surface can
 * represent that the product-native account has been authorized.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  AuthorizationRateLimitWindow,
  AuthorizationSession,
  AuthorizationTelemetry,
  AuthorizationUsageTelemetry,
} from '@deepseek-ai/dsh-authorization'
import type { AuthorizationConnectorTelemetry } from '@deepseek-ai/dsh-authorization/types'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { codexAppServerArgv } from './run.ts'

/** Credential marker for the Codex-managed ChatGPT account session. */
export const CODEX_ACCOUNT_KEY = credentialKey('subagent-codex', 'account')

/** Runtime configuration required to open and dispose the native Codex account bridge. */
export interface CodexAccountBridgeConfig {
  readonly env: Readonly<Record<string, string>>
  readonly disposeGraceMs: number
}

/** Secret-free account, rate-limit, usage, and optional Apps snapshots returned by Codex. */
export interface CodexAccountSnapshot {
  readonly account: unknown
  readonly requiresOpenaiAuth: boolean
  readonly rateLimits?: unknown
  readonly usage?: unknown
  readonly apps?: unknown
  readonly installedApps?: unknown
}

type JsonObject = Record<string, unknown>

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`subagent-codex account: invalid ${label}`)
  }
  return value as JsonObject
}

function maybeObject(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`subagent-codex account: invalid ${label}`)
  }
  return value
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`subagent-codex account: invalid ${label}`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function limitWindow(value: unknown): AuthorizationRateLimitWindow | undefined {
  const source = maybeObject(value)
  if (source === undefined) return undefined
  const usedPercent = optionalNumber(source.usedPercent)
  if (usedPercent === undefined || usedPercent < 0 || usedPercent > 100) return undefined
  const windowDurationMins = optionalNumber(source.windowDurationMins)
  const resetsAt = optionalNumber(source.resetsAt)
  return {
    usedPercent,
    ...windowDurationMins === undefined ? {} : { windowDurationMins },
    ...resetsAt === undefined ? {} : { resetsAt },
  }
}

function usageTelemetry(value: unknown): AuthorizationUsageTelemetry | undefined {
  const response = maybeObject(value)
  const summary = maybeObject(response?.summary)
  if (summary === undefined) return undefined
  const lifetimeTokens = optionalNumber(summary.lifetimeTokens)
  const peakDailyTokens = optionalNumber(summary.peakDailyTokens)
  const longestRunningTurnSec = optionalNumber(summary.longestRunningTurnSec)
  const currentStreakDays = optionalNumber(summary.currentStreakDays)
  const longestStreakDays = optionalNumber(summary.longestStreakDays)
  const telemetry: AuthorizationUsageTelemetry = {
    ...lifetimeTokens === undefined ? {} : { lifetimeTokens },
    ...peakDailyTokens === undefined ? {} : { peakDailyTokens },
    ...longestRunningTurnSec === undefined ? {} : { longestRunningTurnSec },
    ...currentStreakDays === undefined ? {} : { currentStreakDays },
    ...longestStreakDays === undefined ? {} : { longestStreakDays },
  }
  return Object.keys(telemetry).length === 0 ? undefined : telemetry
}

function categoryOf(app: JsonObject): string | undefined {
  const branding = maybeObject(app.branding)
  const branded = optionalString(branding?.category)
  if (branded !== undefined) return branded
  const metadata = maybeObject(app.appMetadata)
  const categories = metadata?.categories
  if (!Array.isArray(categories)) return undefined
  return categories.find((value): value is string => typeof value === 'string' && value.length > 0)
}

function connectorTelemetry(
  appsValue: unknown,
  installedValue: unknown,
): AuthorizationConnectorTelemetry[] | undefined {
  const appsResponse = maybeObject(appsValue)
  if (!Array.isArray(appsResponse?.data)) return undefined

  const installedResponse = maybeObject(installedValue)
  const installedRows = Array.isArray(installedResponse?.apps) ? installedResponse.apps : undefined
  const installedById = new Map<string, JsonObject>()
  for (const row of installedRows ?? []) {
    const installed = maybeObject(row)
    const id = optionalString(installed?.id)
    if (installed !== undefined && id !== undefined) installedById.set(id, installed)
  }

  const connectors: AuthorizationConnectorTelemetry[] = []
  for (const row of appsResponse.data) {
    const app = maybeObject(row)
    if (app === undefined) continue
    const id = optionalString(app.id)
    const name = optionalString(app.name)
    if (id === undefined || name === undefined) continue

    const installed = installedById.get(id)
    const description = optionalString(app.description)
    const iconUrl = optionalString(app.logoUrl)
    const iconUrlDark = optionalString(app.logoUrlDark)
    const category = categoryOf(app)
    const installUrl = optionalString(app.installUrl)
    const accessible = typeof app.isAccessible === 'boolean' ? app.isAccessible : false
    const enabled = typeof app.isEnabled === 'boolean' ? app.isEnabled : true
    const callable = typeof installed?.callable === 'boolean' ? installed.callable : undefined

    connectors.push({
      id,
      name,
      ...description === undefined ? {} : { description },
      ...iconUrl === undefined ? {} : { iconUrl },
      ...iconUrlDark === undefined ? {} : { iconUrlDark },
      ...category === undefined ? {} : { category },
      ...installUrl === undefined ? {} : { installUrl },
      accessible,
      enabled,
      ...installedRows === undefined ? {} : { installed: installed !== undefined },
      ...callable === undefined ? {} : { callable },
    })
  }
  return connectors.length === 0 ? undefined : connectors
}

/**
 * Convert Codex account responses into the fixed public authorization schema.
 * Unknown provider fields are discarded rather than copied through.
 * @param snapshot - native Codex account snapshot to sanitize.
 * @returns the fixed public telemetry projection, or undefined when no supported account is present.
 */
export function codexAccountTelemetry(snapshot: CodexAccountSnapshot): AuthorizationTelemetry | undefined {
  const account = maybeObject(snapshot.account)
  if (account === undefined) return undefined
  const accountType = optionalString(account.type)
  if (accountType === undefined) return undefined

  const rateResponse = maybeObject(snapshot.rateLimits)
  const limits = maybeObject(rateResponse?.rateLimits)
  const primaryLimit = limitWindow(limits?.primary)
  const secondaryLimit = limitWindow(limits?.secondary)
  const rawCredits = maybeObject(limits?.credits)
  const hasCredits = rawCredits?.hasCredits
  const unlimited = rawCredits?.unlimited
  const creditBalance = optionalString(rawCredits?.balance)
  const credits = typeof hasCredits === 'boolean' && typeof unlimited === 'boolean'
    ? {
      hasCredits,
      unlimited,
      ...creditBalance === undefined ? {} : { balance: creditBalance },
    }
    : undefined
  const usage = usageTelemetry(snapshot.usage)
  const connectors = connectorTelemetry(snapshot.apps, snapshot.installedApps)

  const email = optionalString(account.email)
  const plan = optionalString(account.planType)
  return {
    kind: 'account',
    provider: 'Codex',
    accountType,
    ...email === undefined ? {} : { email },
    ...plan === undefined ? {} : { plan },
    ...primaryLimit === undefined ? {} : { primaryLimit },
    ...secondaryLimit === undefined ? {} : { secondaryLimit },
    ...credits === undefined ? {} : { credits },
    ...usage === undefined ? {} : { usage },
    ...connectors === undefined ? {} : { connectors },
  }
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(`subagent-codex account: operation aborted: ${String(signal.reason)}`)
}

class CodexAccountConnection {
  private readonly transport: JsonRpcLineTransport
  private readonly queuedNotifications: Array<{ method: string; params: JsonObject }> = []
  private readonly notificationWaiters = new Set<{
    method: string
    predicate: (params: JsonObject) => boolean
    resolve: (params: JsonObject) => void
  }>()
  private closed = false

  constructor(
    private readonly child: SubprocessHandle,
    private readonly disposeGraceMs: number,
  ) {
    if (child.stdout === undefined || child.stdin === undefined) {
      throw new Error('subagent-codex account: app-server did not expose protocol pipes')
    }
    this.transport = new JsonRpcLineTransport(child.stdout, child.stdin)
    this.transport.onNotification((method, params) => {
      for (const waiter of this.notificationWaiters) {
        if (waiter.method === method && waiter.predicate(params)) {
          this.notificationWaiters.delete(waiter)
          waiter.resolve(params)
          return
        }
      }
      this.queuedNotifications.push({ method, params })
      if (this.queuedNotifications.length > 64) this.queuedNotifications.shift()
    })
  }

  async initialize(signal: AbortSignal, experimentalApi: boolean): Promise<void> {
    this.transport.start()
    object(await this.transport.request('initialize', {
      clientInfo: {
        name: 'phoenix_codex_account',
        title: 'PHOENIX',
        version: '0.0.1',
      },
      capabilities: {
        experimentalApi,
        requestAttestation: false,
      },
    }, signal), 'initialize response')
    this.transport.notify('initialized')
    await this.transport.flush()
  }

  request(method: string, params: object, signal?: AbortSignal): Promise<unknown> {
    return this.transport.request(method, params, signal)
  }

  waitNotification(
    method: string,
    predicate: (params: JsonObject) => boolean,
    signal: AbortSignal,
  ): Promise<JsonObject> {
    const index = this.queuedNotifications.findIndex(item => item.method === method && predicate(item.params))
    if (index >= 0) {
      const [hit] = this.queuedNotifications.splice(index, 1)
      return Promise.resolve((hit as { params: JsonObject }).params)
    }
    if (signal.aborted) return Promise.reject(abortError(signal))
    return new Promise<JsonObject>((resolve, reject) => {
      const waiter = { method, predicate, resolve: (params: JsonObject) => {
        signal.removeEventListener('abort', onAbort)
        resolve(params)
      } }
      const onAbort = (): void => {
        this.notificationWaiters.delete(waiter)
        reject(abortError(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.notificationWaiters.add(waiter)
    })
  }

  processEnded(): Promise<never> {
    return this.child.done.then<never>(
      outcome => Promise.reject(new Error(
        `subagent-codex account: app-server exited before the operation completed (code=${String(outcome.exitCode)}, signal=${String(outcome.signal)})`,
      )),
      error => Promise.reject(error instanceof Error ? error : new Error(String(error))),
    )
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.transport.close()
    try {
      this.child.stdin?.end()
    } catch {
      // A concurrently closed protocol pipe does not change tree ownership.
    }
    this.child.terminate()
    const exited = await this.child.waitForExit(AbortSignal.timeout(Math.ceil(this.disposeGraceMs + 1_000)))
    if (!exited) throw new Error('subagent-codex account: app-server process tree did not terminate')
    await this.child.done.catch(() => {})
  }
}

async function openConnection(
  ctx: Context,
  config: CodexAccountBridgeConfig,
  signal: AbortSignal,
  experimentalApi = false,
): Promise<CodexAccountConnection> {
  const child = ctx.subprocess.spawn({
    argv: codexAppServerArgv(),
    cwd: process.cwd(),
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
    graceMs: config.disposeGraceMs,
    signal,
    env: { ...config.env },
  })
  const connection = new CodexAccountConnection(child, config.disposeGraceMs)
  try {
    await Promise.race([connection.initialize(signal, experimentalApi), connection.processEnded()])
    return connection
  } catch (error) {
    await connection.close().catch(() => {})
    throw error
  }
}

async function readAccount(
  connection: CodexAccountConnection,
  signal: AbortSignal,
): Promise<{ account: unknown; requiresOpenaiAuth: boolean }> {
  const response = object(await Promise.race([
    connection.request('account/read', { refreshToken: false }, signal),
    connection.processEnded(),
  ]), 'account/read response')
  return {
    account: response.account,
    requiresOpenaiAuth: boolean(response.requiresOpenaiAuth, 'account/read requiresOpenaiAuth'),
  }
}

/**
 * Read the optional Codex Apps catalog. Old pinned Codex releases may not expose
 * these experimental methods; that capability miss must never break account,
 * quota, login, or model operation.
 */
async function readOptionalCodexApps(
  connection: CodexAccountConnection,
  signal: AbortSignal,
): Promise<{ apps?: unknown; installedApps?: unknown }> {
  try {
    const data: unknown[] = []
    let cursor: string | undefined
    for (let page = 0; page < 20; page++) {
      const response = object(await Promise.race([
        connection.request('app/list', {
          limit: 100,
          forceRefetch: false,
          ...cursor === undefined ? {} : { cursor },
        }, signal),
        connection.processEnded(),
      ]), 'app/list response')
      if (!Array.isArray(response.data)) return {}
      data.push(...response.data)
      cursor = optionalString(response.nextCursor)
      if (cursor === undefined) break
    }

    let installedApps: unknown
    try {
      installedApps = await Promise.race([
        connection.request('app/installed', { forceRefresh: false }, signal),
        connection.processEnded(),
      ])
    } catch {
      // app/installed was added separately upstream; list metadata is still useful.
    }
    return { apps: { data }, ...installedApps === undefined ? {} : { installedApps } }
  } catch {
    // Capability probing is deliberately fail-soft for Codex 0.147.x compatibility.
    return {}
  }
}

/**
 * Read the native Codex account plus rate-limit/token-activity snapshots.
 * @param ctx - Cordis context used to spawn the Codex app-server.
 * @param config - environment and disposal policy for the native bridge.
 * @param signal - optional cancellation signal for the account read.
 * @returns the current secret-free Codex account snapshot.
 */
export async function readCodexAccountSnapshot(
  ctx: Context,
  config: CodexAccountBridgeConfig,
  signal: AbortSignal = new AbortController().signal,
): Promise<CodexAccountSnapshot> {
  const connection = await openConnection(ctx, config, signal, true)
  try {
    const account = await readAccount(connection, signal)
    if (account.account === null || account.account === undefined) return account
    const accountObject = object(account.account, 'account')
    if (accountObject.type !== 'chatgpt') return account

    const [rateLimits, usage, apps] = await Promise.all([
      Promise.race([
        connection.request('account/rateLimits/read', {}, signal),
        connection.processEnded(),
      ]),
      Promise.race([
        connection.request('account/usage/read', {}, signal),
        connection.processEnded(),
      ]),
      readOptionalCodexApps(connection, signal),
    ])
    return { ...account, rateLimits, usage, ...apps }
  } finally {
    await connection.close()
  }
}

async function commitManagedAccountMarker(ctx: Context): Promise<void> {
  await ctx.credentials.modifyRecord(CODEX_ACCOUNT_KEY, async () => ({ kind: 'api-key' }))
}

/** Run Codex-managed browser login and commit only a secret-free harness marker. */
async function loginManagedChatGpt(
  ctx: Context,
  config: CodexAccountBridgeConfig,
  session: AuthorizationSession,
): Promise<void> {
  const connection = await openConnection(ctx, config, session.signal)
  let loginId: string | undefined
  const cancelLogin = (): void => {
    if (loginId === undefined) return
    void connection.request('account/login/cancel', { loginId }).catch(() => {})
  }
  session.signal.addEventListener('abort', cancelLogin, { once: true })
  try {
    const existing = await readAccount(connection, session.signal)
    if (existing.account !== null && existing.account !== undefined) {
      const account = object(existing.account, 'account')
      if (account.type === 'chatgpt') {
        await commitManagedAccountMarker(ctx)
        session.notify({ message: 'Codex is already connected to ChatGPT; PHOENIX will reuse that managed session.' })
        return
      }
    }

    const started = object(await Promise.race([
      connection.request('account/login/start', {
        type: 'chatgpt',
        useHostedLoginSuccessPage: true,
        appBrand: 'codex',
      }, session.signal),
      connection.processEnded(),
    ]), 'account/login/start response')
    if (started.type !== 'chatgpt') throw new Error('subagent-codex account: Codex did not start a ChatGPT login')
    loginId = string(started.loginId, 'account/login/start loginId')
    const authUrl = string(started.authUrl, 'account/login/start authUrl')
    session.notify({
      message: 'Continue with the official Codex / ChatGPT sign-in. PHOENIX never receives your password or OAuth tokens.',
      url: authUrl,
    })

    const completed = await Promise.race([
      connection.waitNotification(
        'account/login/completed',
        params => params.loginId === loginId,
        session.signal,
      ),
      connection.processEnded(),
    ])
    if (completed.success !== true) {
      throw new Error(`subagent-codex account: ChatGPT login failed${typeof completed.error === 'string' ? `: ${completed.error}` : ''}`)
    }

    const verified = await readAccount(connection, session.signal)
    const account = object(verified.account, 'verified ChatGPT account')
    if (account.type !== 'chatgpt') throw new Error('subagent-codex account: login completed without a ChatGPT account')
    await commitManagedAccountMarker(ctx)
    const plan = typeof account.planType === 'string' ? ` (${account.planType})` : ''
    session.notify({ message: `ChatGPT connected through native Codex authentication${plan}.` })
  } finally {
    session.signal.removeEventListener('abort', cancelLogin)
    await connection.close()
  }
}

/**
 * Register the native Codex account authorization flow.
 * @param ctx - Cordis context that owns authorization and subprocess services.
 * @param config - environment and disposal policy for the native bridge.
 * @returns disposer that unregisters the Codex account flow.
 */
export function registerCodexAccountFlow(
  ctx: Context,
  config: CodexAccountBridgeConfig,
): () => void {
  return ctx.authorization.registerFlow({
    key: CODEX_ACCOUNT_KEY,
    label: 'ChatGPT / Codex',
    methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
    async inspect(signal) {
      const snapshot = await readCodexAccountSnapshot(ctx, config, signal)
      return codexAccountTelemetry(snapshot)
    },
    async run(session) {
      await loginManagedChatGpt(ctx, config, session)
    },
  })
}