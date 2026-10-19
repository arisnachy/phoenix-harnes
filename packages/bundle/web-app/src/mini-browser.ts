/**
 * Same-origin, human-controlled Chromium view for the Phoenix chat MiniBrowser.
 *
 * This is a real CDP browser target, never a third-party iframe. The session
 * descriptor is shared with the MCP Chrome connector so Kira's tools and the
 * human viewport address the same target. Screenshots remain out of the LLM
 * transcript. All exposed routes require same-origin custom headers and a
 * loopback peer; arbitrary page scripts and private profile access are absent.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@phoenix-ai/cordis'
import type {} from '@phoenix-ai/dsh-host-webserver'
import { MiniBrowserScopes, validBrowserScopeId } from './mini-browser-scopes.ts'

type Tab = { id: string; url: string; title: string; type?: string; webSocketDebuggerUrl?: string }
type Descriptor = { pid: number; endpoint: string; selectedTabId?: string }
type RpcReply = { id: number; result?: Record<string, unknown>; error?: { message?: string } }
type CdpEvent = { data?: unknown }
type CdpSocket = {
  send: (payload: string) => void
  close: () => void
  addEventListener: (type: string, listener: (event: CdpEvent) => void) => void
}
type CdpSocketFactory = (url: string) => CdpSocket
type Action = {
  type: string
  url?: string
  tabId?: string
  sessionId?: string
  x?: number
  y?: number
  deltaY?: number
  key?: string
  text?: string
  modifiers?: number
}
const SHARED = join(tmpdir(), 'phoenix-browser-cdp.json')
const VIEWPORT = { width: 1280, height: 720 }
const MAX_BODY = 8192
const MAX_CAPTURE_BYTES = 24 * 1024 * 1024
const CAPTURE_ROOT = join(tmpdir(), 'phoenix-video-captures')
const LIMIT_MS = 8000
const ACTION_LIMIT_MS = 10_000
const START_ACTION_LIMIT_MS = 20_000
const ACTION_ABORT_MESSAGE = 'La acción del navegador fue cancelada.'
let owned: ChildProcess | undefined
let ownedProfile: string | undefined
let ownedEndpoint: string | undefined
let launching: Promise<string> | undefined
let activeTabId: string | undefined
type ScopedBrowser = { child: ChildProcess; profile: string; endpoint?: string }
const scopedBrowsers = new Map<string, ScopedBrowser>()
const scopedLaunching = new Map<string, Promise<string>>()
const SCOPED_BROWSER_ROOT = join(tmpdir(), 'phoenix-mini-browser-cdp')
function scopedDescriptorPath(sessionId: string): string {
  return join(SCOPED_BROWSER_ROOT, createHash('sha256').update(sessionId).digest('hex') + '.json')
}
function announceScopedBrowser(sessionId: string, browser: ScopedBrowser): void {
  if (browser.endpoint === undefined || browser.child.pid === undefined) return
  try {
    mkdirSync(SCOPED_BROWSER_ROOT, { recursive: true, mode: 0o700 })
    writeFileSync(scopedDescriptorPath(sessionId), JSON.stringify({
      sessionId, pid: browser.child.pid, endpoint: browser.endpoint + '/',
    }), { mode: 0o600 })
  } catch { /* UI isolation continues even if MCP handoff fails. */ }
}
function readScopedSelectedTab(sessionId: string): string | undefined {
  try {
    const browser = scopedBrowsers.get(sessionId)
    const record = JSON.parse(readFileSync(scopedDescriptorPath(sessionId), 'utf8')) as {
      sessionId?: string; pid?: number; endpoint?: string; selectedTabId?: string
    }
    return browser?.endpoint !== undefined && record.sessionId === sessionId
      && record.pid === browser.child.pid && record.endpoint === browser.endpoint + '/'
      && validBrowserScopeId(record.selectedTabId) ? record.selectedTabId : undefined
  } catch { return undefined }
}
function publishScopedSelectedTab(sessionId: string, tabId: string): void {
  const browser = scopedBrowsers.get(sessionId)
  if (browser?.endpoint === undefined || browser.child.pid === undefined) return
  try {
    writeFileSync(scopedDescriptorPath(sessionId), JSON.stringify({
      sessionId, pid: browser.child.pid, endpoint: browser.endpoint + '/', selectedTabId: tabId,
    }), { mode: 0o600 })
  } catch { /* Browser remains isolated even if selection persistence fails. */ }
}
function disposeScopedBrowser(sessionId: string): void {
  const browser = scopedBrowsers.get(sessionId)
  scopedBrowsers.delete(sessionId)
  if (browser !== undefined) {
    try { browser.child.kill() } catch { /* May already be closed. */ }
    try { rmSync(browser.profile, { recursive: true, force: true }) } catch { /* Chromium may hold a file. */ }
  }
  try { rmSync(scopedDescriptorPath(sessionId), { force: true }) } catch { /* best effort */ }
}
// Chromium is shared for efficiency; conversations never share targets.
const BROWSER_SCOPE_FILE = join(tmpdir(), 'phoenix-mini-browser-scopes.json')
const browserScopes = new MiniBrowserScopes((() => {
  try { return JSON.parse(readFileSync(BROWSER_SCOPE_FILE, 'utf8')) as unknown }
  catch { return undefined }
})())
let persistedScopeRevision = browserScopes.revision
function persistBrowserScopes(): void {
  if (persistedScopeRevision === browserScopes.revision) return
  const temporary = BROWSER_SCOPE_FILE + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temporary, JSON.stringify(browserScopes.snapshot()), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, BROWSER_SCOPE_FILE)
    persistedScopeRevision = browserScopes.revision
  } catch { /* Keep in-memory isolation if the temporary directory is unavailable. */ }
  finally { try { rmSync(temporary, { force: true }) } catch { /* Non-fatal. */ } }
}

/**
 * Compares the complete shared-browser descriptor before touching the file.
 * @param current - Descriptor currently on disk, if any.
 * @param next - Descriptor that the current process wants to publish.
 * @returns True when the descriptor file must be rewritten.
 */
export function miniBrowserDescriptorNeedsPublish(current: Descriptor | undefined, next: Descriptor): boolean {
  return current?.pid !== next.pid
    || current.endpoint.replace(/\/$/u, '') !== next.endpoint.replace(/\/$/u, '')
    || current.selectedTabId !== next.selectedTabId
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(ACTION_ABORT_MESSAGE)
}
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal)
}

/**
 * One reusable CDP transport for a browser target. Requests are multiplexed by
 * numeric ids and a closed socket rejects every pending request immediately.
 */
export class MiniBrowserCdpSession {
  private readonly socket: CdpSocket
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
    onAbort?: () => void
    cleanup?: () => void
  }>()
  private readonly opened: Promise<void>
  private rejectOpened!: (reason: Error) => void
  private resolveOpened!: () => void
  private readonly openingTimer: ReturnType<typeof setTimeout>
  private nextId = 0
  private closedError: Error | undefined
  private openedSettled = false
  private viewportReady: Promise<void> | undefined

  /**
   * @param url - Loopback DevTools WebSocket URL for one page target.
   * @param timeoutMs - Per-command deadline after the socket opens.
   * @param socketFactory - Injectable socket constructor for the transport.
   */
  constructor(
    url: string,
    private readonly timeoutMs = LIMIT_MS,
    socketFactory: CdpSocketFactory = value => new WebSocket(value),
  ) {
    this.socket = socketFactory(url)
    this.opened = new Promise<void>((resolve, reject) => {
      this.resolveOpened = resolve
      this.rejectOpened = reject
    })
    this.openingTimer = setTimeout(() => {
      this.close('CDP_CONNECTION_TIMEOUT')
    }, Math.min(6000, Math.max(1000, timeoutMs)))
    this.socket.addEventListener('open', () => {
      if (this.closedError || this.openedSettled) return
      this.openedSettled = true
      clearTimeout(this.openingTimer)
      this.resolveOpened()
    })
    this.socket.addEventListener('message', (event) => { this.receive(event) })
    this.socket.addEventListener('error', () => {
      this.close('CDP_SESSION_CLOSED: se perdió la conexión con Chromium')
    })
    this.socket.addEventListener('close', () => {
      this.fail(new Error('CDP_SESSION_CLOSED: Chromium cerró la conexión'))
    })
  }

  /** True after the target's CDP socket has failed or been closed. */
  get closed(): boolean { return this.closedError !== undefined }

  /**
   * Send one CDP command over this target's persistent socket.
   * @param method - CDP method name.
   * @param params - CDP method parameters.
   * @param signal - Optional caller cancellation signal; abort closes this session.
   * @returns The CDP result object.
   */
  async send<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string, params: Record<string, unknown> = {}, signal?: AbortSignal,
  ): Promise<T> {
    throwIfAborted(signal)
    if (method === 'Page.captureScreenshot' || method === 'Input.dispatchMouseEvent') {
      this.viewportReady ??= this.request('Emulation.setDeviceMetricsOverride', {
        ...VIEWPORT, screenWidth: VIEWPORT.width, screenHeight: VIEWPORT.height,
        deviceScaleFactor: 1, mobile: false,
      }, signal).then(() => undefined).catch((error: unknown) => {
        this.viewportReady = undefined
        throw error
      })
      await this.viewportReady
      throwIfAborted(signal)
    }
    return await this.request<T>(method, params, signal)
  }

  /**
   * Close the socket and reject all pending requests immediately.
   * @param reason - Error text used for pending command rejection.
   */
  close(reason = 'CDP_SESSION_CLOSED: sesión descartada'): void {
    this.fail(new Error(reason))
    try { this.socket.close() } catch { /* the socket may already be closed */ }
  }

  private fail(error: Error): void {
    if (this.closedError === undefined) this.closedError = error
    clearTimeout(this.openingTimer)
    if (!this.openedSettled) {
      this.openedSettled = true
      this.rejectOpened(this.closedError)
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.cleanup?.()
      pending.reject(this.closedError)
    }
    this.pending.clear()
  }

  private receive(event: CdpEvent): void {
    let reply: RpcReply
    try { reply = JSON.parse(String(event.data)) as RpcReply } catch { return }
    const pending = this.pending.get(reply.id)
    if (!pending) return
    this.pending.delete(reply.id)
    clearTimeout(pending.timer)
    pending.cleanup?.()
    if (reply.error) pending.reject(new Error(reply.error.message || 'CDP_COMMAND_FAILED'))
    else pending.resolve(reply.result ?? {})
  }

  private request<T extends Record<string, unknown> = Record<string, unknown>>(
    method: string, params: Record<string, unknown>, signal?: AbortSignal,
  ): Promise<T> {
    if (this.closedError !== undefined) return Promise.reject(this.closedError)
    return this.waitForOpen(signal).then(() => new Promise<T>((resolve, reject) => {
      if (this.closedError !== undefined) { reject(this.closedError); return }
      if (signal?.aborted) {
        const error = abortReason(signal)
        reject(error)
        this.close(error.message)
        return
      }
      const id = ++this.nextId
      const timer = setTimeout(() => {
        this.close('Tiempo agotado: ' + method)
      }, this.timeoutMs)
      const pending = {
        resolve: (value) => { resolve(value as T) }, reject, timer,
      } as {
        resolve: (value: unknown) => void
        reject: (error: Error) => void
        timer: ReturnType<typeof setTimeout>
        onAbort?: () => void
        cleanup?: () => void
      }
      if (signal !== undefined) {
        const onAbort = (): void => { this.close(abortReason(signal).message) }
        pending.onAbort = onAbort
        signal.addEventListener('abort', onAbort, { once: true })
        pending.cleanup = () => { signal.removeEventListener('abort', onAbort) }
      }
      this.pending.set(id, pending)
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        this.close(error instanceof Error ? error.message : String(error))
      }
    }))
  }

  private waitForOpen(signal?: AbortSignal): Promise<void> {
    if (signal === undefined) return this.opened
    if (signal.aborted) return Promise.reject(abortReason(signal))
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const onAbort = (): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        const error = abortReason(signal)
        this.close(error.message)
        reject(error)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.opened.then(
        () => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          resolve()
        },
        (error: unknown) => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
  }
}

const cdpSessions = new Map<string, { url: string; session: MiniBrowserCdpSession }>()
const frameFlights = new Map<string, Promise<Buffer>>()

function isLoopback(value: string | undefined): boolean {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1' || value === 'localhost'
}
function validEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && isLoopback(url.hostname) && url.username === '' && url.password === ''
      && url.pathname === '/' && url.search === '' && url.hash === ''
  } catch { return false }
}
function readDescriptor(): Descriptor | undefined {
  try {
    const record = JSON.parse(readFileSync(SHARED, 'utf8')) as Partial<Descriptor>
    if (!validEndpoint(record.endpoint) || !Number.isInteger(record.pid) || !record.pid || record.pid < 1) return
    process.kill(record.pid, 0)
    return {
      pid: record.pid, endpoint: record.endpoint,
      ...(typeof record.selectedTabId === 'string' ? { selectedTabId: record.selectedTabId } : {}),
    }
  } catch { return undefined }
}
function publish(endpoint: string, tabId?: string): void {
  const current = readDescriptor()
  const pid = owned?.pid ?? current?.pid
  if (pid === undefined || !validEndpoint(endpoint)) return
  const selectedTabId = tabId ?? current?.selectedTabId
  const data: Descriptor = { pid, endpoint, ...(selectedTabId === undefined ? {} : { selectedTabId }) }
  if (!miniBrowserDescriptorNeedsPublish(current, data)) return
  try {
    writeFileSync(SHARED, JSON.stringify(data), { mode: 0o600 })
  } catch { /* Browser remains usable without cross-process collaboration. */ }
}
function cleanup(): void {
  for (const { session } of cdpSessions.values()) session.close()
  cdpSessions.clear()
  frameFlights.clear()
  for (const sessionId of scopedBrowsers.keys()) disposeScopedBrowser(sessionId)
  const previous = owned?.pid
  if (previous !== undefined) {
    const ownsDescriptor = readDescriptor()?.pid === previous
    try { owned?.kill() } catch { /* detached browser */ }
    if (ownsDescriptor) {
      try { rmSync(SHARED, { force: true }) } catch { /* best effort */ }
    }
  }
  if (ownedProfile) {
    try { rmSync(ownedProfile, { recursive: true, force: true }) } catch { /* browser may still hold files */ }
  }
  owned = undefined
  ownedEndpoint = undefined
  ownedProfile = undefined
}
function requestSignal(signal?: AbortSignal): AbortSignal {
  const deadline = AbortSignal.timeout(2500)
  return signal === undefined ? deadline : AbortSignal.any([signal, deadline])
}
function awaitAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
async function json<T>(url: string, method = 'GET', signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  const response = await fetch(url, { method, signal: requestSignal(signal) })
  throwIfAborted(signal)
  if (!response.ok) throw new Error('Chromium respondió HTTP ' + String(response.status))
  const body = await response.json() as T
  throwIfAborted(signal)
  return body
}
async function isAlive(endpoint: string, signal?: AbortSignal): Promise<boolean> {
  try { await json(endpoint + '/json/version', 'GET', signal); return true } catch (error) {
    if (signal?.aborted) throw error
    return false
  }
}
function chromiumExecutable(): string {
  const specified = process.env.PHOENIX_BROWSER_EXECUTABLE?.trim() || process.env.DSH_CHROME_EXECUTABLE?.trim()
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA, 'C:\\Program Files', 'C:\\Program Files (x86)']
  const candidates = [
    ...(specified ? [specified] : []),
    ...roots.filter((v): v is string => Boolean(v)).flatMap(root => [
      join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ]
  const executable = candidates.find(candidate => existsSync(candidate))
  if (!executable) throw new Error('No se encontró Chrome o Edge; configura PHOENIX_BROWSER_EXECUTABLE.')
  return executable
}
async function startChromium(signal?: AbortSignal): Promise<string> {
  if (launching) return await awaitAbortable(launching, signal)
  throwIfAborted(signal)
  launching = (async () => {
    try {
      const executable = chromiumExecutable()
      const profile = mkdtempSync(join(tmpdir(), 'phoenix-inline-'))
      ownedProfile = profile
      const child = spawn(executable, [
        '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
        '--user-data-dir=' + profile, '--headless=new', '--mute-audio', '--window-size=1280,820',
        '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check',
        '--disable-sync', 'about:blank',
      ], { stdio: 'ignore', windowsHide: true })
      owned = child
      let spawnFailure: Error | undefined
      child.once('error', (error) => { spawnFailure = error })
      const deadline = Date.now() + START_ACTION_LIMIT_MS
      while (Date.now() < deadline) {
        throwIfAborted(signal)
        try {
          const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0])
          if (Number.isInteger(port) && port > 0 && port < 65536) {
            const endpoint = 'http://127.0.0.1:' + String(port)
            if (await isAlive(endpoint, signal)) {
              ownedEndpoint = endpoint
              publish(endpoint)
              return endpoint
            }
          }
        } catch { /* startup still in progress */ }
        if (child.exitCode !== null || spawnFailure) break
        await awaitAbortable(new Promise<void>(resolve => setTimeout(resolve, 100)), signal)
      }
      throwIfAborted(signal)
      throw new Error('Chromium no inició su canal de control CDP.' + (spawnFailure ? ' ' + String(spawnFailure) : ''))
    } catch (error) {
      cleanup()
      throw error
    }
  })().finally(() => { launching = undefined })
  return launching
}
/**
 * Launch a dedicated hidden Chromium process with its own temporary browser
 * profile for a single chat; never reuse the global CDP endpoint.
 */
async function startScopedChromium(sessionId: string, signal?: AbortSignal): Promise<string> {
  const pending = scopedLaunching.get(sessionId)
  if (pending !== undefined) return await awaitAbortable(pending, signal)
  const launch = (async (): Promise<string> => {
    const executable = chromiumExecutable()
    const profile = mkdtempSync(join(tmpdir(), 'phoenix-chat-browser-'))
    const child = spawn(executable, [
      '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      '--user-data-dir=' + profile, '--headless=new', '--mute-audio',
      '--window-size=1280,820', '--force-device-scale-factor=1',
      '--no-first-run', '--no-default-browser-check', '--disable-sync', 'about:blank',
    ], { stdio: 'ignore', windowsHide: true })
    const browser: ScopedBrowser = { child, profile }
    scopedBrowsers.set(sessionId, browser)
    let spawnFailure: Error | undefined
    child.once('error', error => { spawnFailure = error })
    try {
      const deadline = Date.now() + START_ACTION_LIMIT_MS
      while (Date.now() < deadline) {
        throwIfAborted(signal)
        try {
          const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0])
          if (Number.isInteger(port) && port > 0 && port < 65536) {
            const base = 'http://127.0.0.1:' + String(port)
            if (await isAlive(base, signal)) {
              browser.endpoint = base
              announceScopedBrowser(sessionId, browser)
              return base
            }
          }
        } catch { /* Browser startup is not complete. */ }
        if (child.exitCode !== null || spawnFailure !== undefined) break
        await awaitAbortable(new Promise<void>(resolve => setTimeout(resolve, 100)), signal)
      }
      throwIfAborted(signal)
      throw new Error('No se pudo iniciar el MiniBrowser independiente de esta conversación.'
        + (spawnFailure === undefined ? '' : ' ' + String(spawnFailure)))
    } catch (error) {
      if (scopedBrowsers.get(sessionId) === browser) disposeScopedBrowser(sessionId)
      throw error
    }
  })()
  scopedLaunching.set(sessionId, launch)
  try { return await awaitAbortable(launch, signal) }
  finally { if (scopedLaunching.get(sessionId) === launch) scopedLaunching.delete(sessionId) }
}
async function endpoint(launch: boolean, signal?: AbortSignal, sessionId?: string): Promise<string | undefined> {
  if (sessionId !== undefined) {
    if (!validBrowserScopeId(sessionId)) throw new Error('Identificador de conversación inválido.')
    const browser = scopedBrowsers.get(sessionId)
    if (browser?.endpoint !== undefined && await isAlive(browser.endpoint, signal)) return browser.endpoint
    // A dead chat browser is not replaced with another conversation's process.
    if (browser !== undefined) disposeScopedBrowser(sessionId)
    return launch ? await startScopedChromium(sessionId, signal) : undefined
  }
  // The in-chat browser must not hijack an independently visible Chrome
  // window. External CDP targets are deliberately opt-in, not auto-discovered.
  const allowVisible = process.env.PHOENIX_BROWSER_ALLOW_VISIBLE_CDP === 'true'
  const configured = allowVisible
    ? process.env.PHOENIX_BROWSER_CDP_URL?.trim() || process.env.DSH_CHROME_CDP_URL?.trim()
    : undefined
  if (configured) {
    const normalized = configured.replace(/\/$/, '') + '/'
    if (!validEndpoint(normalized)) throw new Error('CDP solo admite una dirección HTTP de loopback.')
    if (await isAlive(normalized.replace(/\/$/, ''), signal)) return normalized.replace(/\/$/, '')
    throw new Error('No se pudo conectar al CDP configurado.')
  }
  const shared = readDescriptor()
  if (shared !== undefined && await isAlive(shared.endpoint.replace(/\/$/, ''), signal)) return shared.endpoint.replace(/\/$/, '')
  if (ownedEndpoint && await isAlive(ownedEndpoint, signal)) return ownedEndpoint
  for (const port of (allowVisible ? [9222, 9223, 9224] : [])) {
    const base = 'http://127.0.0.1:' + String(port)
    if (await isAlive(base, signal)) return base
  }
  return launch ? await startChromium(signal) : undefined
}
async function listTabs(base: string, signal?: AbortSignal): Promise<Tab[]> {
  const rows = await json<Tab[]>(base + '/json/list', 'GET', signal)
  throwIfAborted(signal)
  return rows.filter(row => row.type === 'page' || row.type === undefined)
}
/**
 * Keep the in-chat browser from selecting the Phoenix UI as its own target.
 * Explicit tab IDs are respected; only automatic selection avoids self-capture.
 * @param tabs - Current Chromium page targets.
 * @param preferred - Previously selected tab, if it is still an external page.
 * @returns A usable non-Phoenix tab ID, or undefined when none exists.
 */
export function miniBrowserAutomaticTabId(
  tabs: readonly { readonly id: string; readonly url: string }[],
  preferred?: string,
): string | undefined {
  const appPort = process.env.PHOENIX_WEB_PORT?.trim() || '3080'
  const external = tabs.filter((tab) => {
    try {
      const location = new URL(tab.url)
      return !(location.port === appPort && isLoopback(location.hostname)
        && ['http:', 'https:'].includes(location.protocol))
    } catch {
      return true
    }
  })
  return external.find(tab => tab.id === preferred)?.id ?? external[0]?.id
}

async function selected(
  base: string, id?: string, available?: Tab[], signal?: AbortSignal, updateSelection = true,
): Promise<Tab> {
  const rows = available ?? await listTabs(base, signal)
  throwIfAborted(signal)
  const requested = id ?? readDescriptor()?.selectedTabId ?? activeTabId
  const chosenId = id === undefined ? miniBrowserAutomaticTabId(rows, requested) : id
  const chosen = rows.find(row => row.id === chosenId)
  if (!chosen?.webSocketDebuggerUrl) throw new Error(
    id === undefined && chosenId === undefined
      ? 'El navegador solo muestra Phoenix; abre una pestaña externa para evitar autorreferencia.'
      : 'No hay una pestaña Chromium disponible.',
  )
  if (updateSelection) {
    activeTabId = chosen.id
    publish(base + '/', chosen.id)
  }
  return chosen
}
async function cdp<T extends Record<string, unknown>>(
  tab: Tab, method: string, params: Record<string, unknown> = {}, signal?: AbortSignal,
): Promise<T> {
  const url = tab.webSocketDebuggerUrl
  if (!url || !url.startsWith('ws://127.0.0.1:') && !url.startsWith('ws://localhost:')) throw new Error('CDP rechazó el destino de pestaña.')
  const current = cdpSessions.get(tab.id)
  if (current?.url !== url || current.session.closed) {
    current?.session.close()
    cdpSessions.delete(tab.id)
  }
  const session = cdpSessions.get(tab.id)?.session ?? (() => {
    const created = new MiniBrowserCdpSession(url)
    cdpSessions.set(tab.id, { url, session: created })
    return created
  })()
  return await session.send<T>(method, params, signal)
}
/**
 * Turn a human address/search query into a safe Chromium HTTP(S) target.
 * @param value - Typed address or search phrase.
 * @returns Validated HTTP(S) URL.
 */
export function normalizeMiniBrowserAddress(value: string): string {
  const raw = value.trim()
  if (raw.length === 0 || raw.length > 2048) throw new Error('Dirección no válida.')
  const candidate = /^https?:\/\//i.test(raw) ? raw
    : /^(?:localhost|127\.0\.0\.1|\[[a-f0-9:]+\])(?::\d+)?(?:\/|$)/i.test(raw) ? 'http://' + raw
      : /^[^\s]+\.[^\s]+$/u.test(raw) ? 'https://' + raw : 'https://www.google.com/search?q=' + encodeURIComponent(raw)
  const result = new URL(candidate)
  if (!['http:', 'https:'].includes(result.protocol) || result.username || result.password) throw new Error('Solo se permiten direcciones HTTP(S).')
  return result.href
}
async function state(knownBase?: string, tabId?: string, signal?: AbortSignal, sessionId?: string): Promise<Record<string, unknown>> {
  const base = knownBase ?? await endpoint(false, signal, sessionId)
  if (!base) return { available: false, tabs: [] }
  const tabs = await listTabs(base, signal)
  if (tabs.length === 0) return { available: false, tabs: [] }
  if (sessionId !== undefined) {
    // Every target belongs to this dedicated Chromium process's conversation,
    // including tabs opened by Kira's Chrome MCP in the same isolated instance.
    for (const tab of tabs) browserScopes.claim(sessionId, tab.id)
    if (tabId === undefined) {
      const advertised = readScopedSelectedTab(sessionId)
      if (advertised !== undefined && tabs.some(tab => tab.id === advertised)) {
        browserScopes.select(sessionId, advertised)
      }
    }
    const chosenId = browserScopes.choose(sessionId, tabs.map(tab => tab.id), tabId)
    persistBrowserScopes()
    if (chosenId === undefined) return { available: false, tabs: [] }
    const chosen = await selected(base, chosenId, tabs, signal, false)
    return {
      available: true, tabId: chosen.id, url: chosen.url, title: chosen.title,
      tabs: tabs.filter(tab => browserScopes.owns(sessionId, tab.id))
        .map(({ id, url, title }) => ({ id, url, title })),
    }
  }
  const selectedTab = await selected(base, tabId, tabs, signal, tabId === undefined)
  return {
    available: true, tabId: selectedTab.id, url: selectedTab.url, title: selectedTab.title,
    tabs: tabs.map(({ id, url, title }) => ({ id, url, title })),
  }
}
/**
 * Chromium versions, headless settings and shared DevTools targets do not
 * implement every capture option equally. Try one tightly cropped frame,
 * then the visible viewport, then the software surface, without navigating or
 * replacing the browser/tab. Never fake a successful screenshot.
 * @param capture - Execute one CDP screenshot request against the same tab.
 * @returns A verified JPEG buffer from Chromium.
 */
export async function captureBrowserFrameWithFallback(
  capture: (params: Record<string, unknown>) => Promise<{ data: string }>,
): Promise<Buffer> {
  const attempts: Record<string, unknown>[] = [
    // Never clip beyond the actual page. Chromium responds with only the
    // visible viewport after the same-session emulation override.
    { format: 'jpeg', quality: 65, captureBeyondViewport: false, fromSurface: true },
    { format: 'jpeg', quality: 60, captureBeyondViewport: false, fromSurface: false },
    { format: 'jpeg', quality: 60 },
  ]
  const failures: string[] = []
  for (const [index, options] of attempts.entries()) {
    try {
      const reply = await capture(options)
      if (typeof reply.data !== 'string' || reply.data.length < 16 || reply.data.length > 6_000_000) {
        throw new Error('Chromium devolvió una imagen vacía o demasiado grande')
      }
      const jpeg = Buffer.from(reply.data, 'base64')
      if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('El fotograma no es JPEG')
      return jpeg
    } catch (error) {
      failures.push('estrategia ' + String(index + 1) + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  throw new Error('CDP_CAPTURE_FAILED: no se pudo obtener un fotograma real. ' + failures.join(' | '))
}
/**
 * Coalesce simultaneous captures for one real Chromium target.
 * @param targetId - Stable CDP page identifier.
 * @param capture - One capture operation to run when no capture is active.
 * @returns The shared verified frame promise.
 */
export async function captureBrowserFrameSingleFlight(
  targetId: string, capture: () => Promise<Buffer>,
): Promise<Buffer> {
  const existing = frameFlights.get(targetId)
  if (existing) return await existing
  const pending = Promise.resolve().then(capture)
  frameFlights.set(targetId, pending)
  try {
    return await pending
  } finally {
    if (frameFlights.get(targetId) === pending) frameFlights.delete(targetId)
  }
}
async function frame(tabId?: string, sessionId?: string): Promise<Buffer> {
  if (sessionId !== undefined && tabId === undefined) throw new Error('Falta el identificador de pestaña de esta conversación.')
  const base = await endpoint(false, undefined, sessionId)
  if (!base) throw new Error('El navegador no está iniciado.')
  if (sessionId !== undefined) await state(base, tabId, undefined, sessionId)
  const tab = await selected(base, tabId, undefined, undefined, sessionId === undefined && tabId === undefined)
  return await captureBrowserFrameSingleFlight(tab.id, async () =>
    await captureBrowserFrameWithFallback(async params =>
      await cdp<{ data: string }>(tab, 'Page.captureScreenshot', params)))
}
/**
 * A visible OS Chrome/Edge window is never created by Kira's routine CDP
 * navigation. This is called solely from the MiniBrowser's explicit
 * “Abrir navegador completo” user gesture, keeping the controlled tab intact.
 * The new desktop window uses the user's ordinary Chrome profile; it opens
 * the same URL but does not share the isolated headless browser's cookies.
 */
async function openVisibleDesktopBrowser(rawUrl: string): Promise<void> {
  const url = normalizeMiniBrowserAddress(rawUrl)
  const executable = chromiumExecutable()
  const child = spawn(executable, ['--new-window', url], {
    windowsHide: false,
    detached: true,
    stdio: 'ignore',
  })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => { resolve() })
    child.once('error', reject)
  })
  child.unref()
}

async function action(input: Action, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const type = input.type
  const sessionId = input.sessionId
  if (sessionId !== undefined && !validBrowserScopeId(sessionId)) throw new Error('Conversación inválida.')
  throwIfAborted(signal)
  const base = await endpoint(type === 'open' || type === 'new-tab' || type === 'start', signal, sessionId)
  throwIfAborted(signal)
  if (!base) throw new Error('Inicia el navegador primero.')
  if (type === 'start') {
    if (sessionId === undefined) return await state(base, undefined, signal)
    const available = await listTabs(base, signal)
    // The initial Chrome page already belongs to this dedicated instance.
    for (const tab of available) browserScopes.claim(sessionId, tab.id)
    if (browserScopes.choose(sessionId, available.map(tab => tab.id)) === undefined) {
      // A new conversation gets its own blank target, never Chrome's last global tab.
      const tab = await json<Tab>(base + '/json/new?' + encodeURIComponent('about:blank'), 'PUT', signal)
      throwIfAborted(signal)
      browserScopes.claim(sessionId, tab.id)
    }
    persistBrowserScopes()
    return await state(base, undefined, signal, sessionId)
  }
  if (type === 'new-tab') {
    const target = normalizeMiniBrowserAddress(input.url ?? 'https://www.google.com')
    throwIfAborted(signal)
    const tab = await json<Tab>(base + '/json/new?' + encodeURIComponent(target), 'PUT', signal)
    throwIfAborted(signal)
    if (sessionId !== undefined) {
      browserScopes.claim(sessionId, tab.id)
      browserScopes.select(sessionId, tab.id)
      publishScopedSelectedTab(sessionId, tab.id)
    }
    else { activeTabId = tab.id; publish(base + '/', tab.id) }
    persistBrowserScopes()
    return await state(base, undefined, signal, sessionId)
  }
  let targetTabId = input.tabId
  if (sessionId !== undefined) {
    const available = await listTabs(base, signal)
    for (const tab of available) browserScopes.claim(sessionId, tab.id)
    const owned = browserScopes.choose(sessionId, available.map(tab => tab.id))
    if (targetTabId !== undefined && !browserScopes.owns(sessionId, targetTabId)) {
      throw new Error('No puedes controlar una pestaña de otra conversación.')
    }
    targetTabId ??= owned
    if (targetTabId === undefined) throw new Error('Esta conversación todavía no tiene pestañas.')
    browserScopes.select(sessionId, targetTabId)
    persistBrowserScopes()
  }
  const tab = await selected(base, targetTabId, undefined, signal, sessionId === undefined)
  if (type === 'select-tab') {
    if (typeof input.tabId !== 'string') throw new Error('Falta la pestaña.')
    throwIfAborted(signal)
    const res = await fetch(base + '/json/activate/' + encodeURIComponent(tab.id), { signal: requestSignal(signal) })
    throwIfAborted(signal)
    if (!res.ok) throw new Error('No se pudo activar la pestaña.')
    if (sessionId === undefined) activeTabId = tab.id
    else publishScopedSelectedTab(sessionId, tab.id)
  } else if (type === 'close-tab') {
    if ((await listTabs(base, signal)).length < 2) throw new Error('Debes conservar una pestaña abierta.')
    throwIfAborted(signal)
    const res = await fetch(base + '/json/close/' + encodeURIComponent(tab.id), { signal: requestSignal(signal) })
    throwIfAborted(signal)
    if (!res.ok) throw new Error('No se pudo cerrar la pestaña.')
    cdpSessions.get(tab.id)?.session.close('CDP_SESSION_CLOSED: pestaña cerrada')
    cdpSessions.delete(tab.id)
    frameFlights.delete(tab.id)
    if (sessionId !== undefined) browserScopes.release(sessionId, tab.id)
    else activeTabId = undefined
  } else if (type === 'open' || type === 'navigate') {
    const url = normalizeMiniBrowserAddress(input.url ?? 'https://www.google.com')
    throwIfAborted(signal)
    await cdp(tab, 'Page.navigate', { url }, signal)
  } else if (type === 'open-external') {
    // Never open a separate macro browser until the human explicitly asks
    // from the MiniBrowser's own footer. No background model auto-popup.
    if (!/^https?:\/\//iu.test(tab.url)) throw new Error('No hay una página web para abrir en Chrome.')
    throwIfAborted(signal)
    await openVisibleDesktopBrowser(tab.url)
  } else if (type === 'back' || type === 'forward') {
    const history = await cdp<{ currentIndex: number; entries: Array<{ id: number }> }>(tab, 'Page.getNavigationHistory', {}, signal)
    const index = history.currentIndex + (type === 'back' ? -1 : 1)
    const entry = history.entries[index]
    if (entry) {
      throwIfAborted(signal)
      await cdp(tab, 'Page.navigateToHistoryEntry', { entryId: entry.id }, signal)
    }
  } else if (type === 'reload') {
    throwIfAborted(signal)
    await cdp(tab, 'Page.reload', { ignoreCache: false }, signal)
  } else if (type === 'click' || type === 'scroll') {
    const x = input.x, y = input.y
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
      || x < 0 || y < 0 || x > VIEWPORT.width || y > VIEWPORT.height) throw new Error('Coordenadas inválidas.')
    if (type === 'click') {
      await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, signal)
      throwIfAborted(signal)
      await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, signal)
    } else {
      const deltaY = Math.max(-1500, Math.min(1500, Number(input.deltaY) || 0))
      await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY }, signal)
    }
  } else if (type === 'key') {
    const key = input.key ?? ''
    if (!/^[\p{L}\p{N}\p{P}\p{S} ]$/u.test(key)
      && !['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key))
      throw new Error('Tecla no admitida.')
    const modifiers = Number(input.modifiers) & 15
    const virtualKeys: Record<string, number> = {
      Enter: 13, Tab: 9, Backspace: 8, Delete: 46, Escape: 27,
      ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35,
    }
    const virtual = virtualKeys[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0)
    const printable = key.length === 1 && modifiers === 0
    const text = printable ? key : key === 'Enter' ? '\r' : undefined
    const params = { key, code: key, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, modifiers }
    await cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(text === undefined ? {} : { text }) }, signal)
    throwIfAborted(signal)
    await cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params }, signal)
  } else if (type === 'text') {
    const text = input.text
    if (typeof text !== 'string' || text.length > 4096) throw new Error('Texto no válido.')
    await cdp(tab, 'Input.insertText', { text }, signal)
  } else throw new Error('Acción de navegador desconocida.')
  throwIfAborted(signal)
  persistBrowserScopes()
  return await state(base, undefined, signal, sessionId)
}
/**
 * Reject DNS rebinding and cross-origin browser requests, even on localhost.
 * @param input - Request metadata sampled from the local HTTP peer.
 * @returns True only for an authorized local browser request.
 */
export function miniBrowserRequestAllowed(input: {
  remoteAddress?: string | undefined
  host?: string | undefined
  origin?: string | undefined
  marker?: string | undefined
  fetchSite?: string | undefined
}): boolean {
  const address = input.remoteAddress?.replace(/^::ffff:/, '')
  if (!isLoopback(address) || input.marker !== '1') return false
  const host = input.host ?? ''
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/i.test(host)) return false
  if (input.origin !== undefined && input.origin !== 'http://' + host && input.origin !== 'https://' + host) return false
  if (input.fetchSite === 'cross-site') return false
  return true
}
/**
 * Node's IncomingHttpHeaders admits string[], but the authorization marker
 * must be a single exact value. Multiple occurrences are not authenticated.
 * @param value - Header value read from the incoming request.
 * @returns The marker only when Node received one string value.
 */
export function miniBrowserSingleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}
function authorized(req: IncomingMessage): boolean {
  return miniBrowserRequestAllowed({
    remoteAddress: req.socket.remoteAddress, host: req.headers.host, origin: req.headers.origin,
    marker: miniBrowserSingleHeader(req.headers['x-phoenix-mini-browser']),
    fetchSite: req.headers['sec-fetch-site'],
  })
}
function reply(res: ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(data))
}
async function readAction(req: IncomingMessage): Promise<Action> {
  let raw = ''
  for await (const chunk of req) {
    raw += String(chunk)
    if (raw.length > MAX_BODY) throw new Error('Solicitud demasiado grande.')
  }
  const body = JSON.parse(raw) as unknown
  if (typeof body !== 'object' || body === null || Array.isArray(body)
    || typeof (body as { type?: unknown }).type !== 'string') throw new Error('Acción mal formada.')
  return body as Action
}
function requestTabId(req: IncomingMessage): string | undefined {
  const value = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('tabId')
  if (value === null) return undefined
  if (!validBrowserScopeId(value)) throw new Error('Identificador de pestaña no válido.')
  return value
}
function requestSessionId(req: IncomingMessage): string | undefined {
  const value = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('sessionId')
  if (value === null) return undefined
  if (!validBrowserScopeId(value)) throw new Error('Identificador de conversación no válido.')
  return value
}

/** Accept only bounded WebM bytes, never arbitrary uploads or web URLs.
 * @param buffer - Binary POST content from the user's authorized tab recording.
 * @returns True only for a bounded WebM EBML header.
 */
export function isVerifiedWebmCapture(buffer: Buffer): boolean {
  return buffer.length >= 128 && buffer.length <= MAX_CAPTURE_BYTES
    && buffer[0] === 0x1a && buffer[1] === 0x45
    && buffer[2] === 0xdf && buffer[3] === 0xa3
}
async function receiveAuthorizedCapture(req: IncomingMessage): Promise<{ captureId: string; bytes: number }> {
  if (req.headers['content-type']?.startsWith('video/webm') !== true) throw new Error('VIDEO_CAPTURE_TYPE_INVALID')
  const length = Number(req.headers['content-length'])
  if (req.headers['content-length'] !== undefined
    && (!Number.isInteger(length) || length < 128 || length > MAX_CAPTURE_BYTES)) {
    throw new Error('VIDEO_CAPTURE_SIZE_INVALID')
  }
  const parts: Buffer[] = []
  let total = 0
  for await (const incoming of req) {
    const bytes = Buffer.from(incoming as string | Uint8Array)
    total += bytes.length
    if (total > MAX_CAPTURE_BYTES) throw new Error('VIDEO_CAPTURE_TOO_LARGE')
    parts.push(bytes)
  }
  const body = Buffer.concat(parts)
  if (!isVerifiedWebmCapture(body)) throw new Error('VIDEO_CAPTURE_WEBM_INVALID')
  mkdirSync(CAPTURE_ROOT, { recursive:true,mode:0o700 })
  // Old recordings expire and are removed opportunistically.
  for (const name of readdirSync(CAPTURE_ROOT)) {
    if (!/^capture-[a-f0-9-]{36}\.webm$/i.test(name)) continue
    const path = join(CAPTURE_ROOT,name)
    try {
      if (Date.now() - statSync(path).mtimeMs > 60 * 60_000) rmSync(path,{ force:true })
    } catch { /* A disappearing expired recording is harmless. */ }
  }
  const captureId = randomUUID()
  writeFileSync(join(CAPTURE_ROOT,'capture-'+captureId+'.webm'),body,{ flag:'wx',mode:0o600 })
  const marker = JSON.stringify({ id:captureId,createdAt:Date.now(),bytes:body.length })
  const staging = join(CAPTURE_ROOT,'latest-'+captureId+'.tmp')
  try {
    writeFileSync(staging,marker,{ flag:'wx',mode:0o600 })
    renameSync(staging,join(CAPTURE_ROOT,'latest.json'))
  } finally { rmSync(staging,{ force:true }) }
  return { captureId,bytes:body.length }
}

/**
 * Register the four bounded MiniBrowser routes in the existing Phoenix Web host.
 * @param ctx - Active Cordis context with a bound Web server.
 */
export function registerMiniBrowserRoutes(ctx: Context): void {
  const sharedGuard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!authorized(req)) { reply(res, 403, { error: 'Acceso de navegador no autorizado.' }); return false }
    return true
  }
  const disposers = [
    ctx.webServer.register({ kind: 'exact', path: '/phoenix-mini-browser/state', handler: async (req, res) => {
      if (!sharedGuard(req, res)) return
      if (req.method !== 'GET') { reply(res, 405, { error: 'Método no permitido.' }); return }
      try { reply(res, 200, await state(undefined, requestTabId(req), undefined, requestSessionId(req))) }
      catch (error) { if (!res.writableEnded && !res.destroyed) reply(res, 503, { error: String(error) }) }
    } }),
    ctx.webServer.register({ kind: 'exact', path: '/phoenix-mini-browser/frame', handler: async (req, res) => {
      if (!sharedGuard(req, res)) return
      if (req.method !== 'GET') { reply(res, 405, { error: 'Método no permitido.' }); return }
      try {
        const jpeg = await frame(requestTabId(req), requestSessionId(req))
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        res.end(jpeg)
      } catch (error) { if (!res.writableEnded && !res.destroyed) reply(res, 503, { error: String(error) }) }
    } }),
    ctx.webServer.register({ kind: 'exact', path: '/phoenix-mini-browser/capture', handler: async (req, res) => {
      if (!sharedGuard(req, res)) return
      if (req.method !== 'POST') { reply(res, 405, { error:'Método no permitido.' }); return }
      try { reply(res, 201, await receiveAuthorizedCapture(req)) }
      catch (error) { reply(res, 400, { error:String(error) }) }
    } }),
    ctx.webServer.register({ kind: 'exact', path: '/phoenix-mini-browser/action', handler: async (req, res) => {
      if (!sharedGuard(req, res)) return
      if (req.method !== 'POST') { reply(res, 405, { error: 'Método no permitido.' }); return }
      if (!req.headers['content-type']?.startsWith('application/json')) { reply(res, 415, { error: 'Solo JSON.' }); return }
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      const clientState = { closed: false }
      const onClose = (): void => {
        if (!res.writableEnded) {
          clientState.closed = true
          controller.abort(new Error(ACTION_ABORT_MESSAGE))
        }
      }
      const armDeadline = (milliseconds: number): void => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => {
          controller.abort(new Error('Tiempo agotado ejecutando la acción del navegador.'))
        }, milliseconds)
      }
      armDeadline(ACTION_LIMIT_MS)
      res.once('close', onClose)
      try {
        const input = await awaitAbortable(readAction(req), controller.signal)
        if (input.type === 'start') armDeadline(START_ACTION_LIMIT_MS)
        throwIfAborted(controller.signal)
        const result = await action(input, controller.signal)
        if (!controller.signal.aborted && !res.writableEnded) reply(res, 200, result)
      } catch (error) {
        if (!clientState.closed && !res.writableEnded && !res.destroyed) {
          reply(res, controller.signal.aborted ? 504 : 400, { error: String(error) })
        }
      } finally {
        if (timer !== undefined) clearTimeout(timer)
        res.off('close', onClose)
      }
    } }),
  ]
  ctx.effect(() => () => { for (const dispose of disposers) dispose(); cleanup() }, 'web-app: mini browser routes')
}
process.once('exit', cleanup)
