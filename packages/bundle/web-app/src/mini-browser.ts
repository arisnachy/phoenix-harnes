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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@phoenix-ai/cordis'
import type {} from '@phoenix-ai/dsh-host-webserver'
import { browserVaultSupported, hasSecureBrowserLogin, saveSecureBrowserLogin, resolveSecureBrowserLogin, forgetSecureBrowserLogin, secureBrowserOrigin } from './mini-browser-vault.ts'

type Tab = { id: string; url: string; title: string; type?: string; webSocketDebuggerUrl?: string }
type Descriptor = { pid: number; endpoint: string; selectedTabId?: string }
type RpcReply = { id: number; result?: Record<string, unknown>; error?: { message?: string } }
type Action = { type: string; url?: string; tabId?: string; x?: number; y?: number; deltaY?: number; key?: string; text?: string; modifiers?: number }
const SHARED = join(tmpdir(), 'phoenix-browser-cdp.json')
const VIEWPORT = { width: 1280, height: 720 }
const MAX_BODY = 8192
const LIMIT_MS = 8000
let owned: ChildProcess | undefined
let ownedProfile: string | undefined
let ownedEndpoint: string | undefined
let launching: Promise<string> | undefined
let activeTabId: string | undefined
let pendingVaultOrigin: string | undefined

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
    return { pid: record.pid, endpoint: record.endpoint, ...(typeof record.selectedTabId === 'string' ? { selectedTabId: record.selectedTabId } : {}) }
  } catch { return undefined }
}
function publish(endpoint: string, tabId?: string): void {
  const current = readDescriptor()
  const pid = owned?.pid ?? current?.pid
  if (pid === undefined || !validEndpoint(endpoint)) return
  const data: Descriptor = { pid, endpoint, ...(tabId === undefined ? {} : { selectedTabId: tabId }) }
  try { writeFileSync(SHARED, JSON.stringify(data), { mode: 0o600 }) } catch { /* Browser remains usable without cross-process collaboration. */ }
}
function cleanup(): void {
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
async function json<T>(url: string, method = 'GET'): Promise<T> {
  const response = await fetch(url, { method, signal: AbortSignal.timeout(2500) })
  if (!response.ok) throw new Error('Chromium respondió HTTP ' + response.status)
  return await response.json() as T
}
async function isAlive(endpoint: string): Promise<boolean> {
  try { await json(endpoint + '/json/version'); return true } catch { return false }
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
async function startChromium(): Promise<string> {
  if (launching) return launching
  launching = (async () => {
    const executable = chromiumExecutable()
    const profile = mkdtempSync(join(tmpdir(), 'phoenix-inline-'))
    ownedProfile = profile
    const child = spawn(executable, [
      '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      '--user-data-dir=' + profile, '--headless=new', '--window-size=1280,820',
      '--force-device-scale-factor=1', '--no-first-run', '--no-default-browser-check',
      '--disable-sync', 'about:blank',
    ], { stdio: 'ignore', windowsHide: true })
    owned = child
    let spawnFailure: Error | undefined
    child.once('error', error => { spawnFailure = error })
    const deadline = Date.now() + LIMIT_MS
    while (Date.now() < deadline) {
      try {
        const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0])
        if (Number.isInteger(port) && port > 0 && port < 65536) {
          const endpoint = 'http://127.0.0.1:' + port
          if (await isAlive(endpoint)) {
            ownedEndpoint = endpoint
            publish(endpoint)
            return endpoint
          }
        }
      } catch { /* startup still in progress */ }
      if (child.exitCode !== null || spawnFailure) break
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    cleanup()
    throw new Error('Chromium no inició su canal de control CDP.' + (spawnFailure ? ' ' + String(spawnFailure) : ''))
  })().finally(() => { launching = undefined })
  return launching
}
async function endpoint(launch: boolean): Promise<string | undefined> {
  const configured = process.env.PHOENIX_BROWSER_CDP_URL?.trim() || process.env.DSH_CHROME_CDP_URL?.trim()
  if (configured) {
    const normalized = configured.replace(/\/$/, '') + '/'
    if (!validEndpoint(normalized)) throw new Error('CDP solo admite una dirección HTTP de loopback.')
    if (await isAlive(normalized.replace(/\/$/, ''))) return normalized.replace(/\/$/, '')
    throw new Error('No se pudo conectar al CDP configurado.')
  }
  const shared = readDescriptor()
  if (shared !== undefined && await isAlive(shared.endpoint.replace(/\/$/, ''))) return shared.endpoint.replace(/\/$/, '')
  if (ownedEndpoint && await isAlive(ownedEndpoint)) return ownedEndpoint
  for (const port of [9222, 9223, 9224]) {
    const base = 'http://127.0.0.1:' + port
    if (await isAlive(base)) return base
  }
  return launch ? await startChromium() : undefined
}
async function listTabs(base: string): Promise<Tab[]> {
  const rows = await json<Tab[]>(base + '/json/list')
  return rows.filter(row => row.type === 'page' || row.type === undefined)
}
async function selected(base: string, id?: string): Promise<Tab> {
  const rows = await listTabs(base)
  const requested = id ?? readDescriptor()?.selectedTabId ?? activeTabId
  const chosen = rows.find(row => row.id === requested) ?? (id === undefined ? rows[0] : undefined)
  if (!chosen?.webSocketDebuggerUrl) throw new Error('No hay una pestaña Chromium disponible.')
  activeTabId = chosen.id
  publish(base + '/', chosen.id)
  return chosen
}
async function cdp<T extends Record<string, unknown>>(tab: Tab, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = tab.webSocketDebuggerUrl
  if (!url || !url.startsWith('ws://127.0.0.1:') && !url.startsWith('ws://localhost:')) throw new Error('CDP rechazó el destino de pestaña.')
  const socket = new WebSocket(url)
  const id = Math.floor(Math.random() * 2147483647)
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const settle = (error?: Error, result?: T): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolve(result as T)
    }
    const timer = setTimeout(() => { settle(new Error('Tiempo agotado: ' + method)) }, LIMIT_MS)
    socket.addEventListener('open', () => { socket.send(JSON.stringify({ id, method, params })) })
    socket.addEventListener('message', event => {
      let reply: RpcReply
      try { reply = JSON.parse(String(event.data)) as RpcReply } catch { return }
      if (reply.id !== id) return
      if (reply.error) settle(new Error(reply.error.message || method + ' falló'))
      else settle(undefined, (reply.result ?? {}) as T)
    })
    socket.addEventListener('error', () => { settle(new Error('Se perdió la conexión con Chromium.')) })
  })
}
/** Turn a human address/search query into a safe Chromium HTTP(S) target. */
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
async function state(): Promise<Record<string, unknown>> {
  const base = await endpoint(false)
  if (!base) return { available: false, tabs: [] }
  const tabs = await listTabs(base)
  if (tabs.length === 0) return { available: false, tabs: [] }
  const selectedTab = await selected(base)
  return { available: true, tabId: selectedTab.id, url: selectedTab.url, title: selectedTab.title, tabs: tabs.map(({ id, url, title }) => ({ id, url, title })) }
}
async function frame(): Promise<Buffer> {
  const base = await endpoint(false)
  if (!base) throw new Error('El navegador no está iniciado.')
  const tab = await selected(base)
  // An explicit 16:9 clip keeps the displayed image and CDP input coordinates
  // in sync. Emulation overrides are session-scoped; separate short-lived CDP
  // sockets must not rely on an override surviving socket closure.
  const response = await cdp<{ data: string }>(tab, 'Page.captureScreenshot', {
    format: 'jpeg', quality: 63, captureBeyondViewport: true, fromSurface: true,
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: 1 },
  })
  if (typeof response.data !== 'string' || response.data.length > 6_000_000) throw new Error('Fotograma inválido.')
  return Buffer.from(response.data, 'base64')
}
async function action(input: Action): Promise<Record<string, unknown>> {
  const type = input.type
  const base = await endpoint(type === 'open' || type === 'new-tab')
  if (!base) throw new Error('Inicia el navegador primero.')
  if (type === 'new-tab') {
    const target = normalizeMiniBrowserAddress(input.url ?? 'https://www.google.com')
    const tab = await json<Tab>(base + '/json/new?' + encodeURIComponent(target), 'PUT')
    activeTabId = tab.id; publish(base + '/', tab.id)
    return await state()
  }
  const tab = await selected(base, input.tabId)
  if (type === 'select-tab') {
    if (typeof input.tabId !== 'string') throw new Error('Falta la pestaña.')
    const res = await fetch(base + '/json/activate/' + encodeURIComponent(tab.id), { signal: AbortSignal.timeout(2500) })
    if (!res.ok) throw new Error('No se pudo activar la pestaña.')
    activeTabId = tab.id
  } else if (type === 'close-tab') {
    if ((await listTabs(base)).length < 2) throw new Error('Debes conservar una pestaña abierta.')
    const res = await fetch(base + '/json/close/' + encodeURIComponent(tab.id), { signal: AbortSignal.timeout(2500) })
    if (!res.ok) throw new Error('No se pudo cerrar la pestaña.')
    activeTabId = undefined
  } else if (type === 'open' || type === 'navigate') {
    const url = normalizeMiniBrowserAddress(input.url ?? 'https://www.google.com')
    await cdp(tab, 'Page.navigate', { url })
  } else if (type === 'back' || type === 'forward') {
    const history = await cdp<{ currentIndex: number; entries: Array<{ id: number }> }>(tab, 'Page.getNavigationHistory')
    const index = history.currentIndex + (type === 'back' ? -1 : 1)
    const entry = history.entries?.[index]
    if (entry) await cdp(tab, 'Page.navigateToHistoryEntry', { entryId: entry.id })
  } else if (type === 'reload') {
    await cdp(tab, 'Page.reload', { ignoreCache: false })
  } else if (type === 'click' || type === 'scroll') {
    const x = input.x, y = input.y
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)
      || x < 0 || y < 0 || x > VIEWPORT.width || y > VIEWPORT.height) throw new Error('Coordenadas inválidas.')
    if (type === 'click') {
      await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
      await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    } else {
      const deltaY = Math.max(-1500, Math.min(1500, Number(input.deltaY) || 0))
      await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY })
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
    await cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(text === undefined ? {} : { text }) })
    await cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  } else if (type === 'text') {
    const text = input.text
    if (typeof text !== 'string' || text.length > 4096) throw new Error('Texto no válido.')
    await cdp(tab, 'Input.insertText', { text })
  } else throw new Error('Acción de navegador desconocida.')
  return await state()
}
/** Inject credentials into the correct Chromium origin without returning them to a model. */
async function browserVaultLogin(tab: Tab, origin: string, account: string, secret: string): Promise<{ phase: string; submitted: boolean }> {
  const expected = secureBrowserOrigin(origin)
  if (secureBrowserOrigin(tab.url) !== expected) throw new Error('La pestaña cambió de dominio; acceso detenido.')
  const expression = `(() => {
    const expected = ${JSON.stringify(expected)};
    if (location.origin !== expected) return JSON.stringify({ phase: 'origin-mismatch', submitted: false });
    const account = ${JSON.stringify(account)};
    const secret = ${JSON.stringify(secret)};
    const visible = el => el instanceof HTMLInputElement && el.type !== 'hidden' && el.type !== 'file' && el.getClientRects().length > 0;
    const inputs = Array.from(document.querySelectorAll('input')).filter(visible);
    const user = inputs.find(el => /user|email|login|account/.test((el.name + ' ' + el.id + ' ' + el.autocomplete + ' ' + el.placeholder).toLowerCase()))
      || inputs.find(el => el.type === 'email' || el.type === 'text');
    const password = inputs.find(el => el.type === 'password');
    if (!user && !password) return JSON.stringify({ phase: 'fields-not-found', submitted: false });
    const assign = (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('El campo no admite edición segura');
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    if (user) assign(user, account);
    if (password) assign(password, secret);
    const form = password?.form || user?.form;
    if (!form) return JSON.stringify({ phase: 'credentials-filled', submitted: false });
    if (new URL(form.action || location.href, location.href).origin !== expected)
      return JSON.stringify({ phase: 'cross-origin-form', submitted: false });
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
    return JSON.stringify({ phase: 'credentials-submitted', submitted: true });
  })()`
  const result = await cdp<{ result?: { value?: unknown } }>(tab, 'Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: false,
  })
  let parsed: unknown
  try { parsed = JSON.parse(String(result.result?.value)) }
  catch { throw new Error('La página no confirmó la operación de acceso.') }
  if (typeof parsed !== 'object' || parsed === null || !('phase' in parsed) || typeof parsed.phase !== 'string'
      || !('submitted' in parsed) || typeof parsed.submitted !== 'boolean') {
    throw new Error('La página no confirmó la operación de acceso.')
  }
  if (parsed.phase === 'origin-mismatch' || parsed.phase === 'cross-origin-form') {
    throw new Error('El formulario apunta a otro dominio; acceso detenido.')
  }
  return { phase: parsed.phase, submitted: parsed.submitted }
}

type VaultAction = { type: 'connect' | 'forget' | 'run' | 'dismiss'; origin: string; account?: string; secret?: string; remember?: boolean }
async function readVaultAction(req: IncomingMessage): Promise<VaultAction> {
  let raw = ''
  for await (const chunk of req) {
    raw += String(chunk)
    if (raw.length > 25000) throw new Error('Solicitud demasiado grande.')
  }
  const input: unknown = JSON.parse(raw)
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Solicitud inválida.')
  const candidate = input as Record<string, unknown>
  if (!['connect','forget','run','dismiss'].includes(String(candidate.type))
      || typeof candidate.origin !== 'string') throw new Error('Acción del vault inválida.')
  return candidate as VaultAction
}
async function browserVaultAction(input: VaultAction): Promise<Record<string, unknown>> {
  if (!browserVaultSupported()) throw new Error('El vault cifrado requiere Windows.')
  const expected = secureBrowserOrigin(input.origin)
  const base = await endpoint(false)
  if (!base) throw new Error('Primero inicia el navegador.')
  const tab = await selected(base)
  if (secureBrowserOrigin(tab.url) !== expected) throw new Error('El dominio de la pestaña ha cambiado.')
  if (input.type === 'dismiss') {
    if (pendingVaultOrigin === expected) pendingVaultOrigin = undefined
    return { dismissed: true }
  }
  if (input.type === 'forget') {
    pendingVaultOrigin = undefined
    await forgetSecureBrowserLogin(expected)
    return { configured: false, forgotten: true, origin: expected }
  }
  if (input.type === 'run') {
    const credentials = await resolveSecureBrowserLogin(expected)
    if (!credentials) {
      pendingVaultOrigin = expected
      return { configured: false, requiresUser: true, origin: expected }
    }
    const result = await browserVaultLogin(tab, expected, credentials.account, credentials.secret)
    return { origin: expected, configured: true, ...result }
  }
  if (typeof input.account !== 'string' || typeof input.secret !== 'string'
      || input.account.length > 4096 || input.secret.length > 16384 || !input.account.trim() || !input.secret) {
    throw new Error('Completa las credenciales en el formulario privado.')
  }
  const result = await browserVaultLogin(tab, expected, input.account, input.secret)
  if (result.phase === 'fields-not-found') return { origin: expected, configured: false, ...result }
  if (input.remember === true) await saveSecureBrowserLogin(expected, input.account, input.secret)
  if (pendingVaultOrigin === expected) pendingVaultOrigin = undefined
  return { origin: expected, configured: input.remember === true, ...result }
}
async function browserVaultStatus(): Promise<Record<string, unknown>> {
  if (!browserVaultSupported()) return { supported: false, configured: false }
  const base = await endpoint(false)
  if (!base) return { supported: true, configured: false }
  const tab = await selected(base)
  try {
    const origin = secureBrowserOrigin(tab.url)
    return { supported: true, origin, configured: hasSecureBrowserLogin(origin),
      requiresUser: pendingVaultOrigin === origin }
  } catch { return { supported: true, configured: false } }
}

/** Reject DNS rebinding and cross-origin browser requests, even on localhost. */
export function miniBrowserRequestAllowed(input: {
  remoteAddress?: string | undefined; host?: string | undefined; origin?: string | undefined;
  marker?: string | undefined; fetchSite?: string | undefined;
}): boolean {
  const address = input.remoteAddress?.replace(/^::ffff:/, '')
  if (!isLoopback(address) || input.marker !== '1') return false
  const host = input.host ?? ''
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/i.test(host)) return false
  if (input.origin !== undefined && input.origin !== 'http://' + host && input.origin !== 'https://' + host) return false
  if (input.fetchSite === 'cross-site') return false
  return true
}
function authorized(req: IncomingMessage): boolean {
  return miniBrowserRequestAllowed({
    remoteAddress: req.socket.remoteAddress, host: req.headers.host, origin: req.headers.origin,
    marker: req.headers['x-phoenix-mini-browser'] as string | undefined,
    fetchSite: req.headers['sec-fetch-site'] as string | undefined,
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
/** Register the three bounded MiniBrowser routes in the existing Phoenix Web host. */
export function registerMiniBrowserRoutes(ctx: Context): void {
  const sharedGuard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!authorized(req)) { reply(res, 403, { error: 'Acceso de navegador no autorizado.' }); return false }
    return true
  }
  const disposers = [
    ctx.webServer.register({ kind: 'exact', path: '/phoenix-mini-browser/state', handler: async (req, res) => {
      if (!sharedGuard(req, res)) return
      if (req.method !== 'GET') { reply(res, 405, { error: 'Método no permitido.' }); return }
      try { reply(res, 200, await state()) } catch (error) { reply(res, 503, { error: String(error) }) }
    } }),
    ctx.webServer.register({ kind: 'exact', path: '/phoenix-mini-browser/frame', handler: async (req, res) => {
      if (!sharedGuard(req, res)) return
      if (req.method !== 'GET') { reply(res, 405, { error: 'Método no permitido.' }); return }
      try {
        const jpeg = await frame()
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        res.end(jpeg)
      } catch (error) { reply(res, 503, { error: String(error) }) }
    } }),
    ctx.webServer.register({ kind: 'exact', path: '/phoenix-mini-browser/vault', handler: async (req, res) => {
      if (!sharedGuard(req, res)) return
      if (req.method === 'GET') {
        try { reply(res, 200, await browserVaultStatus()) }
        catch { reply(res, 503, { error: 'No se pudo comprobar el vault.' }) }
        return
      }
      if (req.method !== 'POST') { reply(res, 405, { error: 'Método no permitido.' }); return }
      if (!req.headers['content-type']?.startsWith('application/json')) { reply(res, 415, { error: 'Solo JSON.' }); return }
      try {
        const input = await readVaultAction(req)
        // Only the foreground human-facing MiniBrowser can save/delete logins;
        // a local MCP process can request an existing approved origin's login.
        if (input.type !== 'run' && !req.headers.origin) { reply(res, 403, { error: 'Requiere interacción humana.' }); return }
        reply(res, 200, await browserVaultAction(input))
      } catch {
        // Never echo exceptions that might include a credential or CDP source.
        reply(res, 400, { error: 'No se pudo completar la operación segura del vault.' })
      }
    } }),
    ctx.webServer.register({ kind: 'exact', path: '/phoenix-mini-browser/action', handler: async (req, res) => {
      if (!sharedGuard(req, res)) return
      if (req.method !== 'POST') { reply(res, 405, { error: 'Método no permitido.' }); return }
      if (!req.headers['content-type']?.startsWith('application/json')) { reply(res, 415, { error: 'Solo JSON.' }); return }
      try { reply(res, 200, await action(await readAction(req))) }
      catch (error) { reply(res, 400, { error: String(error) }) }
    } }),
  ]
  ctx.effect(() => () => { for (const dispose of disposers) dispose(); cleanup() }, 'web-app: mini browser routes')
}
process.once('exit', cleanup)
