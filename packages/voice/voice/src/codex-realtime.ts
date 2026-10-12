/** Native ChatGPT/Codex realtime bridge for PHOENIX conversational voice.
 *
 * The bridge talks only to the locally authenticated Codex app-server. It
 * deliberately forces ChatGPT login and removes OPENAI_API_KEY from the child
 * environment so voice can never silently fall onto separately billed API
 * credentials.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

interface RpcPending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface NotificationWaiter {
  readonly predicate: (params: unknown) => boolean
  readonly resolve: (params: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface NotificationWait {
  readonly promise: Promise<unknown>
  readonly cancel: () => void
}

interface UnknownRecord {
  readonly [key: string]: unknown
}

/** One compact role-bearing Phoenix message used to seed Realtime V3. */
export interface CodexRealtimeInitialItem {
  /** Realtime text role accepted by Codex. */
  readonly role: 'user' | 'developer' | 'assistant'
  /** Plain visible text only; no tools, images, reasoning, or secrets. */
  readonly text: string
}

/** Voices accepted by current Codex Realtime V3 and the legacy V1 path. */
export type CodexRealtimeVoice =
  | 'marin' | 'cedar' | 'alloy'
  | 'juniper' | 'maple' | 'spruce' | 'ember' | 'vale'
  | 'breeze' | 'arbor' | 'sol' | 'cove'

/** Pick Kira's voice for the negotiated protocol, not the text model.
 * @param gender - Persisted assistant presentation.
 * @param version - Codex Realtime protocol selected by negotiation.
 * @returns A supported voice identifier for this protocol generation.
 */
export function realtimeVoiceForGender(
  gender: 'masculine' | 'feminine' | 'neutral' = 'feminine',
  version: 'v3' | 'v1' = 'v3',
): CodexRealtimeVoice {
  if (version === 'v1') {
    if (gender === 'masculine') return 'cove'
    if (gender === 'neutral') return 'breeze'
    return 'juniper'
  }
  if (gender === 'masculine') return 'cedar'
  if (gender === 'neutral') return 'alloy'
  return 'marin'
}

/** One finalized realtime transcript segment. */
export interface CodexRealtimeTranscript {
  readonly role: 'user' | 'assistant'
  readonly text: string
}

/** Inputs for one authenticated Codex WebRTC negotiation. */
export interface CodexRealtimeStartOptions {
  /** Stable Phoenix session key owning this voice call. */
  readonly key: string
  /** Browser-generated WebRTC SDP offer. */
  readonly offerSdp: string
  /** Current Codex text model used by delegated work, when direct. */
  readonly model?: string
  /** Small recent Phoenix transcript used instead of the full startup prompt. */
  readonly initialItems?: readonly CodexRealtimeInitialItem[]
  /** Persisted Phoenix assistant name; provider branding must never replace it. */
  readonly assistantName?: string
  /** Persisted Phoenix assistant presentation used for identity wording. */
  readonly assistantGender?: 'masculine' | 'feminine' | 'neutral'
  /** Final transcript callback used to mirror the live call into Phoenix chat. */
  readonly onTranscript?: (transcript: CodexRealtimeTranscript) => void
}

/** Successful Codex app-server WebRTC negotiation. */
export interface CodexRealtimeStartResult {
  /** Ephemeral Codex thread created for the live conversation. */
  readonly threadId: string
  /** Remote SDP answer to apply to the browser peer connection. */
  readonly answerSdp: string
}

/** Readiness of subscription-backed Codex realtime voice. */
export interface CodexRealtimeProbe {
  /** Whether the local Codex binary and experimental realtime API are usable. */
  readonly available: boolean
  /** Whether app-server reports an active ChatGPT account. */
  readonly authenticated: boolean
  /** Stable unavailability reason for client fallback. */
  readonly reason?: 'codex-unavailable' | 'codex-login-required' | 'experimental-unavailable'
  /** Sanitized error from the local CLI for diagnosing startup failures. */
  readonly detail?: string
}

const RPC_TIMEOUT_MS = 30_000
// Account metadata allows 45s for Codex's state-db startup/backfill on Windows.
// Initialize must not fail sooner than that proven account path.
const CODEX_INITIALIZE_TIMEOUT_MS = 45_000
const SDP_TIMEOUT_MS = 30_000
const IDLE_CLOSE_MS = 60_000
// Even if the browser dies without a hangup RPC, no remote voice thread may
// retain the Codex app-server indefinitely. A call can be reopened explicitly.
const MAX_REALTIME_CALL_MS = 60 * 60_000
const LIVE_REPAIR_COOLDOWN_MS = 30 * 60_000

/**
 * Detect a freshly confirmed latest managed Codex CLI without another npm poll.
 * @param home Managed Phoenix DSH profile root.
 * @param now Current epoch time for staleness validation.
 * @returns Current stable version, or undefined when its update state is stale or mismatched.
 */
export function codexLiveCurrentCliVersion(home: string, now = Date.now()): string | undefined {
  try {
    const path = join(resolve(home), 'codex-cli', 'update-state.json')
    const state = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const checked = typeof state.checkedAt === 'string' ? Date.parse(state.checkedAt) : NaN
    if (!Number.isFinite(checked) || checked > now + 60_000 || now - checked > 12 * 60 * 60_000) return undefined
    const current = state.currentVersion
    const latest = state.latestVersion
    if (typeof current !== 'string' || typeof latest !== 'string'
      || !/^\d+\.\d+\.\d+$/u.test(current) || latest !== current) return undefined
    return current
  } catch {
    return undefined
  }
}

/**
 * Wake the existing single-owner updater without concurrent npm installs.
 * @param home Managed Phoenix DSH profile root.
 * @param mode Configured updater mode (auto, notify or off).
 * @param now Epoch timestamp used for deduplication.
 * @returns Whether the wakeup was queued, recently submitted, disabled or failed.
 */
export function queueCodexLiveRepair(
  home: string,
  mode = process.env.PHOENIX_CODEX_UPDATE_MODE ?? 'auto',
  now = Date.now(),
): 'queued' | 'recent' | 'disabled' | 'failed' {
  if (mode.trim().toLowerCase() !== 'auto') return 'disabled'
  const folder = join(resolve(home), 'codex-cli')
  const path = join(folder, 'live-repair-request.json')
  try {
    if (existsSync(path)) {
      const previous = JSON.parse(readFileSync(path, 'utf8')) as { requestedAt?: unknown }
      const last = typeof previous?.requestedAt === 'string' ? Date.parse(previous.requestedAt) : NaN
      if (Number.isFinite(last) && now - last >= 0 && now - last < LIVE_REPAIR_COOLDOWN_MS) return 'recent'
    }
  } catch {
    // A corrupt or partially-written marker must never block an update.
  }
  try {
    mkdirSync(folder, { recursive: true })
    writeFileSync(path, JSON.stringify({
      schema: 1, reason: 'quicksilver-v2', requestedAt: new Date(now).toISOString(),
    }) + '\n', 'utf8')
    return 'queued'
  } catch {
    return 'failed'
  }
}

/** Read the existing updater's progress without starting npm or exposing credentials. */
export type CodexLiveRepairPhase = 'idle' | 'checking' | 'updating' | 'waiting-upstream' | 'ready' | 'blocked' | 'disabled'

export function codexLiveRepairPhase(home: string, now = Date.now()): CodexLiveRepairPhase {
  const root = join(resolve(home), 'codex-cli')
  const requestPath = join(root, 'live-repair-request.json')
  try {
    if (!existsSync(requestPath)) return 'idle'
    const request = JSON.parse(readFileSync(requestPath, 'utf8')) as Record<string, unknown>
    const requested = typeof request.requestedAt === 'string' ? Date.parse(request.requestedAt) : NaN
    if (request.schema !== 1 || request.reason !== 'quicksilver-v2'
      || !Number.isFinite(requested) || requested > now + 60_000
      || now - requested > LIVE_REPAIR_COOLDOWN_MS) return 'idle'

    const statePath = join(root, 'update-state.json')
    if (!existsSync(statePath)) return 'checking'
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>
    const checked = typeof state.checkedAt === 'string' ? Date.parse(state.checkedAt) : NaN
    if (!Number.isFinite(checked) || checked < requested) return 'checking'
    if (state.mode === 'off' || state.mode === 'notify') return 'disabled'
    if (state.status === 'blocked') return 'blocked'
    if (state.status === 'waiting-upstream' || state.status === 'current') return 'waiting-upstream'
    if (state.status === 'applied') {
      const activePath = join(root, 'active.json')
      if (!existsSync(activePath)) return 'checking'
      const active = JSON.parse(readFileSync(activePath, 'utf8')) as Record<string, unknown>
      const activated = typeof active.activatedAt === 'string' ? Date.parse(active.activatedAt) : NaN
      return Number.isFinite(activated) && activated >= requested ? 'ready' : 'checking'
    }
    return state.status === 'available' ? 'updating' : 'checking'
  } catch {
    // A concurrent atomic replacement may briefly prevent reading its file.
    return 'checking'
  }
}

/**
 * Locate the exact managed Codex CLI that PHOENIX model discovery already
 * installs. Voice previously executed ambient 'codex' only, which can be
 * missing from PATH even when the authenticated PHOENIX Codex route works.
 * @param dshHome - PHOENIX profile root containing codex-cli/active.json.
 * @returns Validated entrypoint, or undefined when no managed runtime exists.
 */
export function findManagedCodexRealtimeBin(dshHome: string): string | undefined {
  const runtimeRoot = join(resolve(dshHome), 'codex-cli')
  const markerPath = join(runtimeRoot, 'active.json')
  if (!existsSync(markerPath)) return undefined
  try {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as {
      schema?: unknown
      version?: unknown
      bin?: unknown
    }
    if (marker.schema !== 1 || typeof marker.version !== 'string'
      || !/^\d+\.\d+\.\d+$/u.test(marker.version) || typeof marker.bin !== 'string') return undefined
    const candidate = resolve(runtimeRoot, marker.bin)
    const boundary = runtimeRoot.endsWith(sep) ? runtimeRoot : `${runtimeRoot}${sep}`
    if (!candidate.startsWith(boundary)) return undefined
    return existsSync(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

/** Reuse model discovery's reliable Windows Codex launch convention.
 * @param managed - Validated managed Node CLI, when present.
 * @param platform - Runtime platform, injectable for tests.
 * @param comSpec - Windows command interpreter.
 * @returns Command and argument vector for the Codex app-server.
 */
export function codexRealtimeLaunchCommand(
  managed: string | undefined,
  platform: NodeJS.Platform = process.platform,
  comSpec: string | undefined = process.env.ComSpec,
  sqliteHome?: string,
): { readonly command: string; readonly args: readonly string[] } {
  // Match the already-working Codex account app-server launch contract.
  // Its legacy voice-only SQLite root can enter Codex's 30s migration gate
  // during initialize; pin the canonical account home for both commands.
  // Codex -c parses TOML overrides. Pass an actual double-quoted TOML string
  // as one argv element for managed Node Codex and direct POSIX launches.
  const forcedChatgptLogin = `forced_login_method=${JSON.stringify('chatgpt')}`
  const codexArgs = [
    '-c', forcedChatgptLogin,
    '-c', 'features.realtime_conversation=true',
    '-c', 'features.plugins=false',
    '-c', 'skills.bundled.enabled=false',
    // Windows cmd.exe strips nested TOML quotes; for the PATH fallback the
    // sanitized CODEX_SQLITE_HOME environment is authoritative instead.
    ...(sqliteHome === undefined || (managed === undefined && platform === 'win32')
      ? [] : ['-c', `sqlite_home=${JSON.stringify(sqliteHome)}`]),
    'app-server', '--stdio',
  ]
  if (managed !== undefined) return { command: process.execPath, args: [managed, ...codexArgs] }
  if (platform === 'win32') {
    // cmd.exe can strip TOML value quotes before Codex parses its -c pair.
    // For the shell-only fallback use Codex's documented raw-string fallback
    // (key=chatgpt) instead: it resolves to the same forced login enum, and
    // never splits into an invalid standalone "chatgpt" override.
    const shellArgs = codexArgs.map(arg => arg === forcedChatgptLogin
      ? 'forced_login_method=chatgpt' : arg)
    return { command: comSpec || 'cmd.exe', args: ['/d', '/s', '/c', `codex ${shellArgs.join(' ')}`] }
  }
  return { command: 'codex', args: codexArgs }
}

/**
 * Reuse Codex's authenticated home AND its proven metadata SQLite location.
 * Voice used to create a new SQLite profile on every Phoenix runtime variant;
 * Codex's migration/backfill lock could then exceed the 30s initialize RPC
 * budget while the standard Codex account connection was already healthy.
 * Separate voice threads/sessions remain isolated by their RPC identity.
 * @param parent Process environment, injectable for regression tests.
 */
export function codexRealtimeEnvironment(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...parent }
  // ChatGPT subscription auth only: never silently bill OPENAI_API_KEY.
  delete env.OPENAI_API_KEY
  delete env.PHOENIX_CODEX_SQLITE_HOME
  const configuredHome = parent.CODEX_HOME?.trim()
  const home = configuredHome ? resolve(configuredHome) : join(homedir(), '.codex')
  mkdirSync(home, { recursive: true })
  env.CODEX_HOME = home
  env.CODEX_SQLITE_HOME = home
  return env
}

/** Detect user-level Codex endpoint overrides without exposing URLs or secrets.
 * @param source - Raw local Codex TOML configuration.
 * @returns Names of top-level endpoint override keys only, never their values.
 */
export function codexRealtimeConfigOverrides(source: string): string[] {
  const keys = new Set([
    'experimental_realtime_webrtc_call_base_url',
    'experimental_realtime_ws_base_url',
    'openai_base_url',
    'chatgpt_base_url',
  ])
  const active: string[] = []
  let inRoot = true
  for (const line of source.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (/^\[[^\]]+\]/u.test(trimmed)) { inRoot = false; continue }
    if (!inRoot || trimmed.startsWith('#')) continue
    const match = /^([a-z_]+)\s*=\s*(\S.*)$/u.exec(trimmed)
    if (match !== null && keys.has(match[1]!) && !active.includes(match[1]!)) active.push(match[1]!)
  }
  return active
}

function customRealtimeEndpointWarning(): string {
  const home = process.env.CODEX_HOME?.trim() || join(homedir(), '.codex')
  try {
    const overrides = codexRealtimeConfigOverrides(readFileSync(join(home, 'config.toml'), 'utf8'))
    return overrides.length === 0 ? '' : ' Configuración de Codex personalizada detectada: '
      + overrides.join(', ') + '. Revisa las rutas de conexión con una copia de seguridad; Phoenix no modifica tu configuración.'
  } catch {
    return ''
  }
}

/** Recognize only real Codex login failures; network hiccups must not log users out. */
export function codexRealtimeNeedsLogin(error: unknown): boolean {
  const message = errorText(error)
  return /(?:refresh[\s_-]*token[^\r\n]{0,120}expired|access token could not be refreshed|chatgpt login required|not authenticated|login required|please log out and sign in again)/iu.test(message)
}

/** Small JSON-RPC client around `codex app-server --listen stdio://`. */
export class CodexRealtimeBridge {
  private child: ChildProcessWithoutNullStreams | undefined
  private startup: Promise<void> | undefined
  private stdoutBuffer = ''
  private readonly pending = new Map<string, RpcPending>()
  private readonly notifications = new Map<string, Set<NotificationWaiter>>()
  private readonly sessions = new Map<string, string>()
  private readonly callTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly transcriptListeners = new Map<string, (transcript: CodexRealtimeTranscript) => void>()
  private readonly stderrTail: string[] = []
  private nextRequestId = 1
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private launchedManagedCodexBin: string | undefined
  /** Brief cooldown for identical upstream protocol failures; a CLI change clears it. */
  private lastQuicksilverRejection: { readonly runtime: string; readonly at: number; readonly detail: string } | undefined

  /** Start app-server and verify that its active account is ChatGPT OAuth.
   * @returns Sidecar availability, authentication and a classified failure reason.
   */
  async probe(): Promise<CodexRealtimeProbe> {
    const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    const runtime = findManagedCodexRealtimeBin(home) ?? 'ambient'
    const cached = this.lastQuicksilverRejection
    if (cached !== undefined && cached.runtime === runtime && Date.now() - cached.at < 60_000) {
      // A recent authenticated voice negotiation was rejected upstream.
      // Do not re-open microphone / spawn another app-server just to rediscover
      // the same protocol error; expose the cause and the alternative voice.
      return { available: false, authenticated: true, reason: 'experimental-unavailable', detail: cached.detail }
    }
    try {
      await this.ensureStarted()
      // The account/read snapshot at initial CLI startup does not prove that
      // its refresh token is still valid. The user explicitly requested Live,
      // so ask the official Codex app-server to verify it before acquiring the
      // browser microphone. Do not refresh credentials during passive telemetry.
      if (this.child !== undefined && this.sessions.size === 0) {
        const refreshed = await this.request('account/read', { refreshToken: true })
        // A successful RPC can still report an invalidated ChatGPT grant.
        // Require an actual ChatGPT account instead of reporting Live ready.
        if (!isRecord(refreshed) || !isRecord(refreshed.account) || refreshed.account.type !== 'chatgpt') {
          this.close()
          return { available: true, authenticated: false, reason: 'codex-login-required' }
        }
      }
      this.armIdleClose()
      return { available: true, authenticated: true }
    } catch (error) {
      const message = errorText(error)
      const detail = message
        .replace(/Bearer\s+[^\s]+/giu, 'Bearer [redacted]')
        .replace(/\b(?:sk|sess|token)-[A-Za-z0-9._-]{8,}\b/gu, '[redacted]')
        .replace(/(?:access_token|refresh_token|password)\s*[:=]\s*[^\s,;]+/giu, '[redacted]')
        .slice(0, 360)
      if (/not found|enoent|could not start|spawn/i.test(message)) {
        return { available: false, authenticated: false, reason: 'codex-unavailable', detail }
      }
      if (codexRealtimeNeedsLogin(error) || /(?:chatgpt (?:login|sign-in) required|login required|not authenticated)/iu.test(message)) {
        // Expired official login is not a missing/unsupported voice feature.
        // Drop only the idle voice sidecar; the next explicit request starts
        // with credentials produced by the normal Codex reauthorization flow.
        if (this.sessions.size === 0) this.close()
        return { available: true, authenticated: false, reason: 'codex-login-required', detail }
      }
      return { available: false, authenticated: false, reason: 'experimental-unavailable', detail }
    }
  }

  /** Negotiate one browser WebRTC call through the authenticated Codex backend.
   * @param options Call identity, selected model and browser SDP offer.
   * @returns Negotiated answer SDP and Codex thread identity.
   */
  async start(options: CodexRealtimeStartOptions): Promise<CodexRealtimeStartResult> {
    const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    const runtime = findManagedCodexRealtimeBin(home) ?? 'ambient'
    const cached = this.lastQuicksilverRejection
    // Repeating the same rejected call seconds later does not negotiate a new
    // protocol. Do not hammer the subscription endpoint or reinstall Codex.
    if (cached !== undefined && cached.runtime === runtime && Date.now() - cached.at < 60_000) {
      throw new Error(cached.detail)
    }
    try {
      const result = await this.startOnce(options)
      this.lastQuicksilverRejection = undefined
      return result
    } catch (error) {
      if (!isCodexQuicksilverV2Required(error) || this.sessions.size > 0) throw error
      // Official Codex handles OpenAI-Alpha itself. WebRTC V3 already selects
      // quicksilver=v2 in upstream Rust; neither Phoenix, browser JS nor a
      // fabricated client header can repair a backend rejection.
      // One upstream rejection is sufficient evidence. Restarting the same
      // authenticated binary and reissuing a second WebRTC call cannot repair
      // an OpenAI-Alpha negotiation mismatch in that build.
      const version = codexLiveCurrentCliVersion(home)
      const detail = 'Codex Live: el app-server oficial rechazó la sesión WebRTC v3 '
        + '(invalid_quicksilver_alpha_header, exige quicksilver=v2). '
        + (version === undefined ? 'Versión gestionada no confirmada. ' : `CLI gestionado: ${version}. `)
        + 'Phoenix ya solicita v3; Codex debe enviar la cabecera. '
        + 'No se ha demostrado un fallo de autenticación ni una solución por reinstalación. '
        + 'Puedes usar Kokoro mientras se verifica la compatibilidad del servicio o la red.'
        + customRealtimeEndpointWarning()
      this.lastQuicksilverRejection = { runtime, at: Date.now(), detail }
      throw new Error(detail)
    }
  }

  private async startOnce(options: CodexRealtimeStartOptions): Promise<CodexRealtimeStartResult> {
    await this.ensureStarted()
    await this.stop(options.key).catch(() => {})
    // stop() arms the idle reap when there was no previous call; this start
    // is now active negotiation and must own the sidecar until it settles.
    this.clearIdleClose()

    let threadId: string | undefined
    try {
      threadId = await this.startVoiceThread(options.model)
      if (options.onTranscript !== undefined) this.transcriptListeners.set(threadId, options.onTranscript)
      // AVAS WebRTC now requires the Quicksilver v2 alpha protocol, which the
      // authenticated Codex app-server negotiates through realtime V3. V1
      // first caused invalid_quicksilver_alpha_header on every fresh bridge.
      let answerSdp: string
      try {
        answerSdp = await this.negotiateRealtime(threadId, options, 'v3')
      } catch (error) {
        if (isCodexQuicksilverV2Required(error)) {
          // Preserve the real upstream failure. The official app-server is
          // responsible for OpenAI-Alpha; do not imply Phoenix omitted it.
          throw error
        }
        if (!isRealtimeV3UnsupportedError(error)) throw error
        // Only an explicit local "V3 unsupported" error permits V1 fallback.
        // Never downgrade a 400/403, Quicksilver, auth or network failure.
        await this.request('thread/realtime/stop', { threadId }).catch(() => {})
        this.transcriptListeners.delete(threadId)
        threadId = await this.startVoiceThread(options.model)
        if (options.onTranscript !== undefined) this.transcriptListeners.set(threadId, options.onTranscript)
        answerSdp = await this.negotiateRealtime(threadId, options, 'v1')
      }
      this.sessions.set(options.key, threadId)
      this.armCallExpiry(options.key)
      return { threadId, answerSdp }
    } catch (error) {
      if (threadId !== undefined) {
        this.transcriptListeners.delete(threadId)
        await this.request('thread/realtime/stop', { threadId }).catch(() => {})
      }
      throw error
    } finally {
      if (!this.sessions.has(options.key) && this.sessions.size === 0) this.armIdleClose()
    }
  }

  /** Start the disposable Codex backing thread, retrying only a stale text-model selection. */
  private async startVoiceThread(model: string | undefined): Promise<string> {
    const selectedModel = normalizeCodexModel(model)
    const threadParams: Record<string, unknown> = { ephemeral: true }
    if (selectedModel !== undefined) threadParams.model = selectedModel

    let started: unknown
    try {
      started = await this.request('thread/start', threadParams)
    } catch (error) {
      if (selectedModel === undefined || !isThreadModelCompatibilityError(error)) throw error
      // Voice itself has a dedicated realtime model. A stale/newer text model
      // must not prevent the native voice call from opening.
      started = await this.request('thread/start', { ephemeral: true })
    }
    const threadId = readThreadId(started)
    if (threadId === undefined) throw new Error('Codex realtime thread/start returned no thread id')
    return threadId
  }

  /** Negotiate one Codex-native WebRTC protocol version and surface async startup errors. */
  private async negotiateRealtime(
    threadId: string,
    options: CodexRealtimeStartOptions,
    version: 'v3' | 'v1',
  ): Promise<string> {
    const sdpWait = this.waitForNotification(
      'thread/realtime/sdp',
      params => isRecord(params) && params.threadId === threadId && typeof params.sdp === 'string',
      SDP_TIMEOUT_MS,
    )
    const errorWait = this.waitForNotification(
      'thread/realtime/error',
      params => isRecord(params) && params.threadId === threadId,
      SDP_TIMEOUT_MS,
    )
    const closedWait = this.waitForNotification(
      'thread/realtime/closed',
      params => isRecord(params) && params.threadId === threadId,
      SDP_TIMEOUT_MS,
    )
    const outcome = Promise.race([
      sdpWait.promise.then(params => ({ kind: 'sdp' as const, params })),
      errorWait.promise.then(params => ({ kind: 'error' as const, params })),
      closedWait.promise.then(params => ({ kind: 'closed' as const, params })),
    ])

    try {
      const voice = realtimeVoiceForGender(options.assistantGender, version)
      await this.request('thread/realtime/start', version === 'v3'
        ? {
          threadId,
          // Phoenix owns the harness and explicitly passes finalized
          // speech via thread/realtime/appendSpeech. Codex must not also
          // forward its own automatic text handoffs into Kira's speaker.
          // This is the documented V3 setting for client-owned handoffs.
          clientManagedHandoffs: true,
          flushTranscriptTailOnSessionEnd: true,
          backendReasoningStatus: false,
          outputModality: 'audio',
          // The Phoenix transcript below supplies only the recent useful context.
          // Avoid replaying Codex's much larger startup context into every short
          // voice session: the normal Codex thread still owns delegated work.
          includeStartupContext: false,
          ...(options.initialItems === undefined || options.initialItems.length === 0
            ? {}
            : { initialItems: options.initialItems }),
          realtimeStartInstructions: realtimeIdentityInstructions(
            options.assistantName,
            options.assistantGender,
          ),
          voice,
          transport: { type: 'webrtc', sdp: options.offerSdp },
          version,
        }
        : {
          threadId,
          outputModality: 'audio',
          realtimeStartInstructions: realtimeIdentityInstructions(
            options.assistantName,
            options.assistantGender,
          ),
          voice,
          transport: { type: 'webrtc', sdp: options.offerSdp },
          version,
        })
      const settled = await outcome
      if (settled.kind === 'error') {
        throw new Error(`Codex realtime startup failed: ${realtimeNotificationMessage(settled.params, 'unknown realtime error')}`)
      }
      if (settled.kind === 'closed') {
        throw new Error(`Codex realtime closed before SDP: ${realtimeNotificationMessage(settled.params, 'transport closed')}`)
      }
      if (!isRecord(settled.params) || typeof settled.params.sdp !== 'string') {
        throw new Error('Codex realtime returned an invalid SDP answer')
      }
      return settled.params.sdp
    } finally {
      sdpWait.cancel()
      errorWait.cancel()
      closedWait.cancel()
    }
  }

  /** Report whether Codex currently owns at least one browser realtime call.
   * Important-event speech uses this to avoid mixing a fallback TTS voice into
   * an active native Codex conversation.
   * @returns Whether at least one native Codex Realtime session is active.
   */
  hasActiveSession(): boolean {
    return this.sessions.size > 0
  }

  /**
   * Send speakable text through the official authenticated app-server V3
   * protocol. Unlike a browser response.create instruction, appendSpeech
   * feeds the selected final answer into Codex's speakable sideband channel.
   * No API keys or guessed Quicksilver HTTP headers are involved.
   */
  async speak(key: string, text: string): Promise<boolean> {
    const threadId = this.sessions.get(key)
    if (threadId === undefined || this.child === undefined) return false
    const spoken = text.trim()
    if (spoken === '' || spoken.length > 6000) return false
    await this.request('thread/realtime/appendSpeech', { threadId, text: spoken })
    return this.sessions.get(key) === threadId
  }

  /** Stop one active realtime conversation without affecting text Codex use.
   * @param key Browser-owned call identity.
   * @returns Whether an existing call was removed; transport failures may reject after local removal.
   */
  async stop(key: string): Promise<boolean> {
    this.clearCallExpiry(key)
    const threadId = this.sessions.get(key)
    if (threadId === undefined) {
      if (this.sessions.size === 0) this.armIdleClose()
      return false
    }
    this.sessions.delete(key)
    this.transcriptListeners.delete(threadId)
    try {
      if (this.child !== undefined) await this.request('thread/realtime/stop', { threadId })
    } finally {
      if (this.sessions.size === 0) this.armIdleClose()
    }
    return true
  }

  /** Tear down the sidecar and reject outstanding RPC work. */
  close(): void {
    this.clearIdleClose()
    for (const key of this.callTimers.keys()) this.clearCallExpiry(key)
    const child = this.child
    this.child = undefined
    this.startup = undefined
    this.launchedManagedCodexBin = undefined
    this.sessions.clear()
    if (child !== undefined && !child.killed) {
      // On Windows the npm-installed Codex executable is normally a .cmd shim
      // launched through cmd.exe. Killing only the shell orphans app-server,
      // which keeps its stdio/SQLite workers alive and accumulates background
      // processes across voice sessions. Reap the entire process tree.
      if (process.platform === 'win32' && child.pid !== undefined) {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } else {
        child.kill()
      }
    }
    const error = new Error('Codex realtime app-server closed')
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    for (const waiters of this.notifications.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }
    }
    this.notifications.clear()
  }

  private async ensureStarted(): Promise<void> {
    // Use a newly activated managed Codex CLI without restarting Phoenix.
    // Never disrupt an existing live audio session during a background update.
    if (this.child !== undefined && this.sessions.size === 0) {
      const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
      if (findManagedCodexRealtimeBin(home) !== this.launchedManagedCodexBin) this.close()
    }
    if (this.child !== undefined) return
    if (this.startup !== undefined) return this.startup
    const startup = this.startProcess()
    this.startup = startup
    try {
      await startup
    } finally {
      if (this.startup === startup) this.startup = undefined
    }
  }

  private async startProcess(): Promise<void> {
    const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
    const env = codexRealtimeEnvironment()
    const managedBin = findManagedCodexRealtimeBin(dshHome)
    const { command, args } = codexRealtimeLaunchCommand(
      managedBin, process.platform, process.env.ComSpec, env.CODEX_HOME,
    )

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(command, args, {
        env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      throw new Error(`Codex realtime could not start: ${errorText(error)}`)
    }
    this.child = child
    this.launchedManagedCodexBin = managedBin
    this.stdoutBuffer = ''
    this.stderrTail.length = 0

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    // Codex can exit between an RPC write and Node flushing the pipe. Own the
    // stream error so an EPIPE cannot become an uncaught Host-fatal event.
    child.stdin.on('error', () => {})
    child.stdout.on('data', (chunk) => { this.consumeStdout(String(chunk)) })
    child.stderr.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/u)) {
        const trimmed = line.trim()
        if (trimmed === '') continue
        this.stderrTail.push(trimmed)
        if (this.stderrTail.length > 30) this.stderrTail.shift()
      }
    })
    child.once('error', (error) => {
      this.failProcess(new Error(`Codex realtime process error: ${error.message}`))
    })
    child.once('exit', (code, signal) => {
      if (this.child !== child) return
      const diagnostic = this.stderrTail.slice(-4).join(' | ')
      this.failProcess(new Error(
        `Codex realtime app-server exited (${String(code ?? signal ?? 'unknown')})${diagnostic === '' ? '' : `: ${diagnostic}`}`,
      ))
    })

    try {
      await this.request('initialize', {
        clientInfo: {
          name: 'phoenix_voice',
          title: 'Phoenix Codex Voice',
          version: '1',
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }, CODEX_INITIALIZE_TIMEOUT_MS)
      this.notify('initialized')

      // The stored ChatGPT session may already be valid. Forcing an OAuth refresh
      // on every voice start can reject an otherwise usable login when the
      // refresh endpoint is temporarily unavailable. Codex refreshes credentials
      // on demand for authenticated backend requests.
      const account = await this.request('account/read', { refreshToken: false })
      if (!isRecord(account) || !isRecord(account.account) || account.account.type !== 'chatgpt') {
        throw new Error('Codex ChatGPT login required for subscription-backed realtime voice')
      }
    } catch (error) {
      this.close()
      throw error
    }
  }

  private request(method: string, params?: unknown, timeoutMs = RPC_TIMEOUT_MS): Promise<unknown> {
    const child = this.child
    if (child === undefined || child.stdin.destroyed) {
      return Promise.reject(new Error('Codex realtime app-server is not running'))
    }
    const id = String(this.nextRequestId++)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex realtime RPC timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      const frame = `${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`
      try {
        child.stdin.write(frame, (error) => {
          if (error === null || error === undefined) return
          const active = this.pending.get(id)
          if (active === undefined) return
          clearTimeout(active.timer)
          this.pending.delete(id)
          active.reject(new Error(`Codex realtime RPC write failed: ${errorText(error)}`))
        })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error(`Codex realtime RPC write failed: ${errorText(error)}`))
      }
    })
  }

  private notify(method: string, params?: unknown): void {
    const child = this.child
    if (child === undefined || child.stdin.destroyed || child.stdin.writableEnded) return
    try {
      child.stdin.write(
        `${JSON.stringify({ method, ...(params === undefined ? {} : { params }) })}\n`,
        () => {},
      )
    } catch {
      // Notifications are best-effort during startup/teardown. Request RPCs
      // carry their own explicit failure path.
    }
  }

  private waitForNotification(
    method: string,
    predicate: (params: unknown) => boolean,
    timeoutMs: number,
  ): NotificationWait {
    let waiter!: NotificationWaiter
    const promise = new Promise<unknown>((resolve, reject) => {
      waiter = {
        predicate,
        resolve: (params) => {
          clearTimeout(waiter.timer)
          this.notifications.get(method)?.delete(waiter)
          resolve(params)
        },
        reject: (error) => {
          clearTimeout(waiter.timer)
          this.notifications.get(method)?.delete(waiter)
          reject(error)
        },
        timer: setTimeout(() => {
          this.notifications.get(method)?.delete(waiter)
          reject(new Error(`Codex realtime notification timed out: ${method}`))
        }, timeoutMs),
      }
      let set = this.notifications.get(method)
      if (set === undefined) {
        set = new Set()
        this.notifications.set(method, set)
      }
      set.add(waiter)
    })
    return {
      promise,
      cancel: () => {
        clearTimeout(waiter.timer)
        this.notifications.get(method)?.delete(waiter)
      },
    }
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    while (true) {
      const newline = this.stdoutBuffer.indexOf('\n')
      if (newline < 0) return
      const line = this.stdoutBuffer.slice(0, newline).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line === '') continue
      try {
        this.routeMessage(JSON.parse(line) as unknown)
      } catch {
        // App-server stdout is expected to be JSONL; one malformed diagnostic
        // must not poison the rest of the stream.
      }
    }
  }

  private routeMessage(value: unknown): void {
    if (!isRecord(value)) return
    if (value.id !== undefined && (value.result !== undefined || value.error !== undefined)) {
      if (typeof value.id !== 'string' && typeof value.id !== 'number') return
      const id = String(value.id)
      const pending = this.pending.get(id)
      if (pending === undefined) return
      this.pending.delete(id)
      clearTimeout(pending.timer)
      if (value.error !== undefined) {
        pending.reject(new Error(rpcErrorText(value.error)))
      } else {
        pending.resolve(value.result)
      }
      return
    }
    if (typeof value.method !== 'string') return
    if (value.method === 'thread/realtime/transcript/done' && isRecord(value.params)) {
      const threadId = typeof value.params.threadId === 'string' ? value.params.threadId : undefined
      const role = value.params.role
      const text = typeof value.params.text === 'string' ? value.params.text.trim() : ''
      if (threadId !== undefined && (role === 'user' || role === 'assistant') && text !== '') {
        this.transcriptListeners.get(threadId)?.({ role, text })
      }
    }
    const waiters = this.notifications.get(value.method)
    if (waiters === undefined || waiters.size === 0) return
    for (const waiter of [...waiters]) {
      if (waiter.predicate(value.params)) waiter.resolve(value.params)
    }
  }

  private failProcess(error: Error): void {
    if (this.child !== undefined) this.child = undefined
    this.startup = undefined
    for (const key of this.callTimers.keys()) this.clearCallExpiry(key)
    this.sessions.clear()
    this.transcriptListeners.clear()
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    for (const waiters of this.notifications.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer)
        waiter.reject(error)
      }
    }
    this.notifications.clear()
  }

  /** Absolute host-side expiry protects calls whose browsers can no longer send hangup. */
  private armCallExpiry(key: string): void {
    this.clearCallExpiry(key)
    const timer = setTimeout(() => {
      void this.stop(key).catch(() => undefined)
    }, MAX_REALTIME_CALL_MS)
    timer.unref?.()
    this.callTimers.set(key, timer)
  }

  private clearCallExpiry(key: string): void {
    const timer = this.callTimers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    this.callTimers.delete(key)
  }

  private armIdleClose(): void {
    if (this.sessions.size > 0 || this.child === undefined) return
    this.clearIdleClose()
    this.idleTimer = setTimeout(() => { this.close() }, IDLE_CLOSE_MS)
  }

  private clearIdleClose(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }
}

function realtimeIdentityInstructions(
  name: string | undefined,
  gender: 'masculine' | 'feminine' | 'neutral' | undefined,
): string {
  const assistantName = name?.trim() || 'KIRA'
  const presentation = gender ?? 'feminine'
  const grammar = presentation === 'feminine'
    ? 'When Spanish self-reference is gendered, use feminine forms naturally.'
    : presentation === 'masculine'
      ? 'When Spanish self-reference is gendered, use masculine forms naturally.'
      : 'Prefer naturally gender-neutral Spanish self-reference.'
  return [
    `You are ${assistantName}, the PHOENIX assistant. Your user-facing name is exactly ${assistantName}.`,
    'Codex is an internal execution/runtime backend, never your identity or name. Never introduce yourself as Codex, ChatGPT, the model name, or the provider.',
    grammar,
    'Speak naturally, warmly, and concisely in the user\'s language. This is a continuation of the compact Phoenix conversation history; do not repeat that history.',
    'PHOENIX\'s normal harness is the only planner and executor. This realtime thread is voice transport: transcribe the human faithfully and do not claim tool use, file changes, plans, or completed actions on its own.',
    'Never generate your own spoken answers or progress acknowledgements in response to user audio. Input audio is transcription only.',
    'Only an explicit thread/realtime/appendSpeech message from PHOENIX authorizes speech. Read the already-completed harness answer faithfully, without adding claims, waiting updates, tool status or speculation.',
  ].join(' ')
}

function normalizeCodexModel(model: string | undefined): string | undefined {
  const value = model?.trim()
  if (value === undefined || value === '' || value === 'phoenix-auto') return undefined
  return value.length <= 128 ? value : undefined
}

function isThreadModelCompatibilityError(value: unknown): boolean {
  const message = errorText(value)
  // oxlint-disable-next-line @stylistic/max-len -- Keep the protocol compatibility matcher auditable as one literal.
  return /(?:model|deployment).*(?:not found|unknown|unsupported|unavailable|invalid)|(?:not found|unknown|unsupported|unavailable|invalid).*(?:model|deployment)/iu.test(message)
}

/** A specific server-side AVAS protocol rejection, not a credential failure. */
export function isCodexQuicksilverV2Required(value: unknown): boolean {
  const message = errorText(value)
  return /invalid_quicksilver_alpha_header|AVAS requires OpenAI-Alpha:\s*quicksilver=v2/iu.test(message)
}

function isRealtimeV3UnsupportedError(value: unknown): boolean {
  if (isCodexQuicksilverV2Required(value)) return false
  const message = errorText(value)
  // Explicit unsupported protocol only: never treat generic 400, timeouts,
  // forbidden access or missing WebRTC permissions as version compatibility.
  return /(?:v3|frameless|realtime version).{0,90}(?:unsupported|not supported|unknown|unrecognized)|(?:unsupported|not supported|unknown|unrecognized).{0,90}(?:v3|frameless|realtime version)/iu.test(message)
}

function realtimeNotificationMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback
  const message = typeof value.message === 'string' ? value.message.trim() : ''
  // Codex sometimes forwards a backend JSON error as a single message.
  // Never surface its unbounded raw response in Phoenix's compact voice UI.
  if (isCodexQuicksilverV2Required(message)) {
    return 'invalid_quicksilver_alpha_header: AVAS requiere Quicksilver V2'
  }
  if (message !== '') return message.slice(0, 360)
  const reason = typeof value.reason === 'string' ? value.reason.trim() : ''
  return reason === '' ? fallback : reason.slice(0, 1_024)
}

function readThreadId(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.thread)) return undefined
  return typeof value.thread.id === 'string' && value.thread.id !== '' ? value.thread.id : undefined
}

function rpcErrorText(value: unknown): string {
  if (!isRecord(value)) return `Codex realtime RPC failed: ${String(value)}`
  const message = typeof value.message === 'string' ? value.message : 'Codex realtime RPC failed'
  const code = typeof value.code === 'number' || typeof value.code === 'string' ? String(value.code) : undefined
  return code === undefined ? message : `${code}: ${message}`
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
