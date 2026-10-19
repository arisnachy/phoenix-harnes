/**
 * Local Chromium-browser MCP connector (Chrome or Microsoft Edge).
 *
 * It attaches only to loopback CDP endpoints. When no user-provided endpoint
 * exists, PHOENIX can start a dedicated Chromium instance with an isolated
 * temporary profile; personal Chrome/Edge profile files are never opened.
 * Mutating actions are controlled by Phoenix's permission-derived PHOENIX_BROWSER_ALLOW_ACTIONS policy.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { browserBatchExpression, browserInteractionExpression, type BrowserInteraction, type BrowserInteractionResult } from './browser-interactions.ts'
import { CdpConnectionPool } from './cdp-connection-pool.ts'
import { classifySiteHealth, nextSiteRecoveryStep, siteHealthExpression, type SitePageHealth } from './site-health.ts'
import { runBrowserFormWorkflow } from './form-workflow.ts'
import { formLayoutKey, prepareLearnedFormWorkflow, recallVerifiedFormLayout, sanitizeFormLayout, saveVerifiedFormLayout } from './form-layout-memory.ts'
import { chooseYoutubeCaptions, youtubeCaptionUrl, youtubeTranscript, youtubeWatchUrl, type YoutubeCaptionTrack } from './youtube-video.ts'
import { parseCapturedVideoAudio, transcribeCapturedVideoAudio, videoAudioCaptureExpression } from './video-audio.ts'
import { inspectVideoMedia } from './video-media.ts'

const DEFAULT_PORTS = [9222, 9223, 9224]
/** User-temp discovery lets the in-chat view reuse this exact Chromium tab. */
const SHARED_BROWSER = join(tmpdir(), 'phoenix-browser-cdp.json')
const CHAT_BROWSER_ROOT = join(tmpdir(), 'phoenix-mini-browser-cdp')
function chatBrowserSession(sessionId: string): SharedSession {
  if (!/^[A-Za-z0-9._:-]{1,256}$/u.test(sessionId)) throw new Error('ID de conversación inválido.')
  const file = join(CHAT_BROWSER_ROOT, createHash('sha256').update(sessionId).digest('hex') + '.json')
  let result: SharedSession & { sessionId?: string }
  try {
    result = JSON.parse(readFileSync(file, 'utf8')) as SharedSession & { sessionId?: string }
    const url = new URL(result.endpoint)
    if (result.sessionId !== sessionId || !Number.isInteger(result.pid) || result.pid < 1
      || url.protocol !== 'http:' || !isLoopback(url.hostname) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) throw new Error('Descriptor inválido.')
    process.kill(result.pid, 0)
  } catch { throw new Error('MiniBrowser independiente no está iniciado para esta conversación.') }
  return result
}
type SharedSession = { pid: number; endpoint: string; selectedTabId?: string }
function sharedSession(): SharedSession | undefined {
  try {
    const value = JSON.parse(readFileSync(SHARED_BROWSER, 'utf8')) as SharedSession
    const url = new URL(value.endpoint)
    if (!Number.isInteger(value.pid) || value.pid < 1 || url.protocol !== 'http:'
      || !isLoopback(url.hostname) || url.username || url.password || url.pathname !== '/'
      || url.search || url.hash) return
    process.kill(value.pid, 0)
    return value
  } catch { return undefined }
}
function announceSession(base: string, tabId?: string): void {
  // External Chrome/Edge CDP sessions have no managed browser child PID.
  // The live MCP connector owns their shared tab descriptor until shutdown.
  const pid = managedBrowser?.pid ?? sharedSession()?.pid ?? process.pid
  try {
    writeFileSync(SHARED_BROWSER, JSON.stringify({
      pid, endpoint: base.replace(/\/$/, '') + '/',
      ...(tabId === undefined ? {} : { selectedTabId: tabId }),
    }), { mode: 0o600 })
  } catch { /* An inaccessible descriptor must never block browser tools. */ }
}
process.once('exit', () => {
  // Do not leave a stale pointer to an external Chrome tab when this MCP dies.
  if (sharedSession()?.pid === process.pid) {
    try { rmSync(SHARED_BROWSER, { force: true }) } catch { /* best effort */ }
  }
})
const CDP_READY_TIMEOUT_MS = 6_000
let managedBrowser: ChildProcess | undefined
let managedProfileDir: string | undefined
let managedEndpoint: string | undefined
let managedLaunch: Promise<string> | undefined
let cleanupRegistered = false

const cdpBase = (): string => {
  const raw = (process.env.PHOENIX_BROWSER_CDP_URL?.trim()
    || process.env.DSH_CHROME_CDP_URL?.trim() || '').replace(/\/$/, '')
  if (!raw) return ''
  const url = new URL(raw)
  if (url.protocol !== 'http:' || !isLoopback(url.hostname)) {
    throw new Error('PHOENIX_BROWSER_CDP_URL debe ser HTTP y apuntar a loopback (127.0.0.1, ::1 o localhost)')
  }
  return url.toString().replace(/\/$/, '')
}
const actionsAllowed = () => process.env.PHOENIX_BROWSER_ALLOW_ACTIONS === 'true'
  || process.env.DSH_CHROME_ALLOW_ACTIONS === 'true'
const autostartAllowed = () => process.env.PHOENIX_BROWSER_AUTOSTART !== 'false'
  && process.env.DSH_CHROME_AUTOSTART !== 'false'

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

/**
 * Build Chrome/Edge flags for PHOENIX's isolated CDP browser.
 * @param profileDir - profileDir supplied to this public operation.
 * @param headless - headless supplied to this public operation.
 * @returns Result produced by this public operation.
 */
export function buildDedicatedBrowserArgs(profileDir: string, headless = false): string[] {
  return [
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    '--window-size=1280,820', '--force-device-scale-factor=1',
    ...(headless ? ['--headless=new', '--mute-audio'] : []),
    'about:blank',
  ]
}

function browserExecutableCandidates(): string[] {
  const configured = process.env.PHOENIX_BROWSER_EXECUTABLE?.trim()
    || process.env.DSH_CHROME_EXECUTABLE?.trim()
  const candidates = configured ? [configured] : []

  if (process.platform === 'win32') {
    const roots = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ].filter((value): value is string => Boolean(value))
    const preferred = (process.env.PHOENIX_BROWSER_PREFERRED_ENGINE ?? 'chrome').trim().toLowerCase()
    for (const root of roots) {
      const chrome = join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')
      const edge = join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
      candidates.push(...(preferred === 'edge' ? [edge, chrome] : [chrome, edge]))
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    )
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
    )
  }

  return [...new Set(candidates)]
}

function browserExecutable(): string {
  const executable = browserExecutableCandidates().find(candidate => existsSync(candidate))
  if (executable) return executable
  throw new Error(
    'CDP_NO_LISTO: no se encontró Chrome/Edge/Chromium. Configura PHOENIX_BROWSER_EXECUTABLE con la ruta del navegador.',
  )
}

type Tab = { id: string; title: string; url: string; webSocketDebuggerUrl?: string; type?: string }

/**
 * Resolve a deliberate tab id without silently switching to another page.
 * @param available - Tabs currently reported by Chromium.
 * @param explicitId - User-selected tab id that must match exactly.
 * @param preferredId - Previously selected tab id used only when no explicit id is supplied.
 * @returns The exact explicit tab, the preferred tab, or the first available tab.
 */
export function chooseTab(available: readonly Tab[], explicitId?: string, preferredId?: string): Tab {
  if (explicitId !== undefined) {
    const requested = available.find(candidate => candidate.id === explicitId)
    if (!requested) throw new Error(`No existe la pestaña ${explicitId}`)
    return requested
  }
  const preferred = preferredId === undefined
    ? undefined
    : available.find(candidate => candidate.id === preferredId)
  const tab = preferred ?? available[0]
  if (!tab) throw new Error('El navegador no tiene pestañas web disponibles')
  return tab
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
  if (!response.ok) throw new Error(`El navegador respondió HTTP ${response.status}`)
  return await response.json() as T
}

function cleanupManagedBrowser(): void {
  cdpPool.closeAll('Cierre del navegador gestionado')
  const oldPid = managedBrowser?.pid
  const ownsDescriptor = oldPid !== undefined && sharedSession()?.pid === oldPid
  try { managedBrowser?.kill() } catch { /* best effort */ }
  if (ownsDescriptor) {
    try { rmSync(SHARED_BROWSER, { force: true }) } catch { /* best effort */ }
  }
  managedBrowser = undefined
  managedEndpoint = undefined
  const profileDir = managedProfileDir
  managedProfileDir = undefined
  if (profileDir) {
    try { rmSync(profileDir, { recursive: true, force: true }) } catch { /* browser may still be releasing files */ }
  }
}

async function waitForManagedEndpoint(profileDir: string): Promise<string> {
  const activePortPath = join(profileDir, 'DevToolsActivePort')
  const deadline = Date.now() + CDP_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (existsSync(activePortPath)) {
      try {
        const [rawPort] = readFileSync(activePortPath, 'utf8').split(/\r?\n/)
        const port = Number(rawPort)
        if (Number.isInteger(port) && port > 0 && port <= 65535) {
          const candidate = `http://127.0.0.1:${port}`
          await json(`${candidate}/json/version`)
          return candidate
        }
      } catch { /* file can appear before the endpoint accepts connections */ }
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('CDP_NO_LISTO: el navegador dedicado no publicó DevToolsActivePort a tiempo')
}

async function launchDedicatedBrowser(): Promise<string> {
  if (managedLaunch) return await managedLaunch
  managedLaunch = (async () => {
    const executable = browserExecutable()
    const profileDir = mkdtempSync(join(tmpdir(), 'phoenix-browser-'))
    // Agent navigation uses a private headless Chromium target regardless of
    // stale HEADLESS=false settings. Only the explicit user MiniBrowser footer
    // action may open a visible desktop Chrome window.
    const child = spawn(executable, buildDedicatedBrowserArgs(profileDir, true), {
      stdio: 'ignore',
      windowsHide: true,
    })
    managedBrowser = child
    managedProfileDir = profileDir
    let spawnError: Error | undefined
    child.once('error', (error) => { spawnError = error })
    if (!cleanupRegistered) {
      cleanupRegistered = true
      process.once('exit', cleanupManagedBrowser)
    }
    try {
      const base = await waitForManagedEndpoint(profileDir)
      managedEndpoint = base
      announceSession(base)
      return base
    } catch (error) {
      const exitDetail = child.exitCode === null ? '' : `; proceso terminó con código ${child.exitCode}`
      const spawnDetail = spawnError ? `; ${spawnError.message}` : ''
      cleanupManagedBrowser()
      throw new Error(`CDP_NO_LISTO: no se pudo iniciar el navegador dedicado${exitDetail}${spawnDetail}: ${String(error)}`)
    }
  })().finally(() => { managedLaunch = undefined })
  return await managedLaunch
}

async function endpoint(sessionId?: string): Promise<string> {
  // A browser tool may run before React mounts the MiniBrowser card. Ask the
  // authenticated local Phoenix host to start THAT conversation's Chromium.
  if (sessionId !== undefined) {
    try { return chatBrowserSession(sessionId).endpoint.replace(/\/$/, '') }
    catch {
      const port = Number(process.env.PHOENIX_WEB_PORT || '3080')
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto web de Phoenix inválido.')
      const response = await fetch('http://127.0.0.1:' + String(port) + '/phoenix-mini-browser/action', {
        method: 'POST',
        headers: { 'x-phoenix-mini-browser': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'start', sessionId }),
        signal: AbortSignal.timeout(23_000),
      })
      if (!response.ok) throw new Error('Phoenix no pudo iniciar el MiniBrowser de esta conversación (HTTP ' + response.status + ').')
      return chatBrowserSession(sessionId).endpoint.replace(/\/$/, '')
    }
  }
  // A visible personal Chrome profile must never become the default target of
  // agent navigation. External CDP attachment requires an explicit opt-in.
  const allowVisible = process.env.PHOENIX_BROWSER_ALLOW_VISIBLE_CDP === 'true'
  const configured = allowVisible ? cdpBase() : ''
  if (configured) {
    await json(`${configured}/json/version`)
    return configured
  }
  const shared = sharedSession()
  if (shared !== undefined) {
    const base = shared.endpoint.replace(/\/$/, '')
    try { await json(`${base}/json/version`); return base } catch { /* stale peer */ }
  }
  const discovered = await Promise.all((allowVisible ? DEFAULT_PORTS : []).map(async (port) => {
    const candidate = `http://127.0.0.1:${port}`
    try {
      await json(`${candidate}/json/version`)
      return candidate
    } catch {
      return undefined
    }
  }))
  const existing = discovered.find((candidate): candidate is string => candidate !== undefined)
  if (existing !== undefined) return existing
  if (managedEndpoint) {
    try { await json(`${managedEndpoint}/json/version`); return managedEndpoint } catch { cleanupManagedBrowser() }
  }
  if (autostartAllowed()) return await launchDedicatedBrowser()
  throw new Error(
    'CDP_NO_LISTO: Chrome/Edge no está expuesto por CDP. Activa autostart o inicia un perfil aislado con --remote-debugging-port.',
  )
}

async function tabs(sessionId?: string): Promise<Tab[]> {
  return (await json<Tab[]>(`${await endpoint(sessionId)}/json/list`)).filter(tab => tab.type === 'page' || tab.type === undefined)
}

/**
 * A new user navigation owns its own CDP tab; this keeps earlier MiniBrowser
 * cards tied to their original pages when later chat turns open new sites.
 * Explicit tabId still navigates the supplied tab for deliberate reuse.
 */
async function newBrowserTab(url: string, sessionId?: string): Promise<Tab> {
  const base = await endpoint(sessionId)
  const result = await fetch(base + '/json/new?' + encodeURIComponent(url), {
    method: 'PUT', signal: AbortSignal.timeout(5000),
  })
  if (!result.ok) throw new Error('No se pudo abrir una pestaña Chromium nueva: HTTP ' + String(result.status))
  const tab = await result.json() as Tab
  if (!tab.id || !tab.webSocketDebuggerUrl) throw new Error('Chrome no devolvió un identificador válido')
  if (sessionId === undefined) announceSession(base, tab.id)
  else selectedChatTabs.set(sessionId, tab.id)
  return tab
}
const selectedChatTabs = new Map<string, string>()

async function selectedTab(id?: string, sessionId?: string): Promise<Tab> {
  const available = await tabs(sessionId)
  const preferred = sessionId === undefined ? sharedSession()?.selectedTabId : selectedChatTabs.get(sessionId)
  if (sessionId !== undefined && id === undefined && preferred === undefined && available.length > 1) {
    throw new Error('Indica tabId para seleccionar la pestaña de esta conversación sin confundir trabajos.')
  }
  const tab = chooseTab(available, id, preferred)
  if (!tab.webSocketDebuggerUrl) throw new Error('La pestaña no ofrece una conexión CDP')
  if (sessionId === undefined) announceSession(await endpoint(), tab.id)
  else selectedChatTabs.set(sessionId, tab.id)
  return tab
}

const cdpPool = new CdpConnectionPool()

async function cdp<T = unknown>(tab: Tab, method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
  const debuggerUrl = tab.webSocketDebuggerUrl
  if (!debuggerUrl) throw new Error('La pestaña no ofrece una conexión CDP')
  return await cdpPool.request<T>(debuggerUrl, method, params, timeoutMs)
}

/**
 * Produce a canonical YouTube search URL without extra model calls.
 * @param query - Exact user search phrase, including accented text.
 * @returns Encoded YouTube results URL.
 */
export function youtubeSearchUrl(query: string): string {
  const term = query.trim()
  if (term.length === 0 || term.length > 256) throw new Error('La búsqueda debe tener entre 1 y 256 caracteres')
  const url = new URL('https://www.youtube.com/results')
  url.searchParams.set('search_query', term)
  return url.toString()
}

async function evaluate(tab: Tab, expression: string, timeoutMs = 10_000): Promise<unknown> {
  return await cdp(tab, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs)
}

function ensureBrowserActionPermission(): void {
  if (!actionsAllowed()) throw new Error('Acción bloqueada por permisos del navegador; no intentar usar Computer para eludirlos.')
}

function formatBrowserResult(value: unknown): { content: Array<{ type: 'text'; text: string }>; isError?: true } {
  if (value === undefined || value === null) return { isError: true, content: [{ type: 'text', text: 'Sin resultado verificable del DOM. No se confirma la acción.' }] }
  const result = value as { ok?: boolean }
  const output = JSON.stringify(value)
  return result.ok === false ? { isError: true, content: [{ type: 'text', text: output }] }
    : { content: [{ type: 'text', text: output }] }
}


const server = new McpServer(
  { name: 'phoenix-browser-connector', version: '0.3.0' },
  { capabilities: { tools: {} } },
)

server.registerTool('status', {
  description: 'Comprueba CDP y, si hace falta, inicia el navegador dedicado aislado de PHOENIX.',
  inputSchema: {},
}, async () => {
  try {
    const base = await endpoint()
    const version = await json<Record<string, string>>(`${base}/json/version`)
    return { content: [{ type: 'text', text: `Conectado a ${version.Browser ?? 'navegador Chromium'} en ${base}` }] }
  } catch (error) {
    return { content: [{ type: 'text', text: `Sin conexión: ${String(error)}` }], isError: true }
  }
})

server.registerTool('tabs', {
  description: 'Lista las pestañas exclusivas de la conversación indicada (sessionId).',
  inputSchema: { sessionId: z.string().optional() },
}, async ({ sessionId }) => ({ content: [{ type: 'text', text: JSON.stringify(await tabs(sessionId), null, 2) }] }))

server.registerTool('navigate', {
  description: 'Navega una pestaña a una URL HTTP(S). No envía formularios ni ejecuta acciones de cuenta.',
  inputSchema: { url: z.url(), tabId: z.string().optional(), sessionId: z.string().optional() },
}, async ({ url, tabId, sessionId }) => {
  if (!actionsAllowed()) throw new Error('Navegación bloqueada por la política de permisos del navegador (modo read-only o PHOENIX_BROWSER_ALLOW_ACTIONS=false).')
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Solo se permiten URLs HTTP(S)')
  const tab = tabId === undefined ? await newBrowserTab(url, sessionId) : await selectedTab(tabId, sessionId)
  // /json/new already navigates the new page, while an explicit tabId must
  // navigate the user's chosen existing tab.
  if (tabId !== undefined) await cdp(tab, 'Page.navigate', { url })
  return { content: [{ type: 'text', text: `Navegación iniciada en ${url} (pestaña ${tab.id})` }] }
})

server.registerTool('youtube_search', {
  description: 'Acción rápida: abre YouTube directamente en los resultados de búsqueda de la frase solicitada, usando la sesión de Chrome/Edge y sus permisos actuales. Úsala en UNA sola llamada para peticiones como "abre YouTube y busca Bob Esponja"; no hace falta status, tabs, navigate, click_text, read_page, navegador adicional, subagentes ni review profundo. Tras una comprobación breve de URL, informa el resultado real y termina; no reproduzcas un video si no te lo pidieron. Si falta autorización, informa la restricción una vez, no repitas intentos.',
  inputSchema: { query: z.string().trim().min(1).max(256), tabId: z.string().optional(), sessionId: z.string().optional() },
}, async ({ query, tabId, sessionId }) => {
  const url = youtubeSearchUrl(query)
  if (!actionsAllowed()) {
    return { isError: true, content: [{ type: 'text', text: `Navegación no autorizada por la política actual. No se abrió YouTube. Enlace directo para el usuario: ${url}. No repitas ni eludas el permiso; informa este bloqueo una sola vez.` }] }
  }
  let tab: Tab
  try {
    tab = tabId === undefined ? await newBrowserTab(url, sessionId) : await selectedTab(tabId, sessionId)
    // Opening a new request cannot replace the website shown by an older card.
    if (tabId !== undefined) {
      const navigation = await cdp<{ errorText?: string }>(tab, 'Page.navigate', { url })
      if (navigation.errorText) throw new Error(navigation.errorText)
    }
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: `No se pudo abrir YouTube en Chrome/Edge: ${String(error)}. Enlace directo para el usuario: ${url}. No reintentes automáticamente sin una causa nueva.` }] }
  }
  // One bounded read of tab metadata, not a scrape, screenshot or second model turn.
  // A metadata failure after successful Page.navigate must not lose the navigation receipt.
  const current = await tabs(sessionId).then(rows => rows.find(candidate => candidate.id === tab.id), () => undefined)
  let verified = false
  if (current) {
    try {
      const found = new URL(current.url)
      verified = found.hostname === 'www.youtube.com'
        && found.pathname === '/results'
        && found.searchParams.get('search_query') === query.trim()
    } catch { /* A tab can momentarily expose an intermediate URL. */ }
  }
  return {
    content: [{ type: 'text', text: verified
      ? `Búsqueda abierta en YouTube: ${url} (pestaña ${tab.id}). URL comprobada. Muestra la pestaña al usuario; no se ha reproducido ningún video.`
      : `Navegación a la búsqueda de YouTube iniciada: ${url} (pestaña ${tab.id}). La URL final todavía no se confirmó; no afirmes que los resultados cargaron. Evita comprobaciones repetidas si el usuario solo pidió abrir la búsqueda.` }],
  }
})

server.registerTool('read_page', {
  description: 'Lee el título, URL y texto visible de una pestaña. No accede a cookies ni almacenamiento.',
  inputSchema: { tabId: z.string().optional(), sessionId: z.string().optional(), maxChars: z.number().int().min(1).max(100000).default(30000) },
}, async ({ tabId, maxChars, sessionId }) => {
  const tab = await selectedTab(tabId, sessionId)
  const value = await evaluate(tab, 'JSON.stringify({title: document.title, url: location.href, text: document.body?.innerText || \'\'})')
  const page = JSON.parse(String(value)) as { title: string; url: string; text: string }
  return { content: [{ type: 'text', text: JSON.stringify({ ...page, text: page.text.slice(0, maxChars) }, null, 2) }] }
})

server.registerTool('diagnose_page', {
  description: 'Diagnóstico pasivo de la pestaña seleccionada cuando un sitio queda en blanco, muestra “Blocked”, falla un iframe o no carga una sección. No lee contraseñas, cookies, saldos ni contenido privado. Distingue problemas locales, carga parcial y denegación del sitio. Úsalo antes de afirmar que una tarea no se puede continuar; nunca lo utilices para eludir restricciones de acceso.',
  inputSchema: { tabId: z.string().optional(), sessionId: z.string().optional() },
}, async ({ tabId, sessionId }) => {
  const tab = await selectedTab(tabId, sessionId)
  let sample: SitePageHealth
  try {
    const raw = await evaluate(tab, siteHealthExpression, 7_000)
    if (typeof raw !== 'string') throw new TypeError('Invalid page diagnosis')
    sample = JSON.parse(raw) as SitePageHealth
    if (typeof sample.mainTextLength !== 'number' || typeof sample.blockedMarker !== 'boolean') {
      throw new TypeError('Invalid page health fields')
    }
  } catch {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({
      status: 'browser_diagnostic_unavailable',
      tabId: tab.id,
      next: 'Revisar la conexión Chrome CDP; conservar la sesión actual, no asumir que el sitio denegó acceso.',
    }) }] }
  }
  const status = classifySiteHealth(sample)
  return { content: [{ type: 'text', text: JSON.stringify({
    tabId: tab.id,
    status,
    evidence: sample,
    next: nextSiteRecoveryStep(status),
    warning: 'Una señal Blocked no prueba que toda la página esté inaccesible. Tampoco demuestra una transacción exitosa.',
  }) }] }
})

const targetSchema = {
  selector: z.string().trim().min(1).max(500).optional(),
  name: z.string().trim().min(1).max(150).optional(),
  label: z.string().trim().min(1).max(150).optional(),
  placeholder: z.string().trim().min(1).max(150).optional(),
  text: z.string().trim().min(1).max(150).optional(),
}
const fieldAction = z.object({
  ...targetSchema,
  operation: z.enum(['fill', 'select', 'check', 'click', 'scroll']),
  value: z.string().max(4096).optional(),
  checked: z.boolean().optional(),
})

server.registerTool('inspect_page', {
  description: 'Inspección estructurada y de solo lectura de la pestaña real. Si hubo una verificación exitosa previa en esta ruta, agrega learnedLayout con localizadores seguros revalidados contra el DOM actual, NUNCA valores de campos. Reutiliza esas pistas para ahorrar pasos, pero verifica cada entrada y confirma por separado los envíos.',
  inputSchema: { tabId: z.string().optional(), sessionId: z.string().optional() },
}, async ({ tabId, sessionId }) => {
  const tab = await selectedTab(tabId, sessionId)
  const observed = await evaluate(tab, browserInteractionExpression({ operation: 'inspect' }))
  const layout = await recallVerifiedFormLayout(tab.url).catch(() => undefined)
  const result = observed as BrowserInteractionResult | undefined
  // Hints do not supply values and cannot stand in for the current DOM.
  if (!layout || !result?.ok || !Array.isArray(result.controls)) return formatBrowserResult(observed)
  const controls = result.controls as Array<{ id?: string; name?: string; visible?: boolean; disabled?: boolean; readonly?: boolean; type?: string }>
  const usable = (locator: { selector?: string; name?: string }): boolean => {
    const found = controls.filter(control => control.visible && !control.disabled && !control.readonly
      && control.type !== 'password' && (locator.name !== undefined
        ? control.name === locator.name
        : locator.selector?.startsWith('#') && control.id === locator.selector.slice(1)))
    // Class/tag-and-id selectors are suggestions requiring fresh inspection.
    return found.length === 1
  }
  const suggestions = {
    ...layout,
    steps: layout.steps.filter(usable),
    verifiedChecks: layout.verifiedChecks.filter(usable),
  }
  return formatBrowserResult({
    ...result, ...(suggestions.steps.length || suggestions.verifiedChecks.length
      ? { learnedLayout: suggestions,
          warning: 'Memoria de localizadores SIN datos: revalida controles, valores y autorización actual. No reutilices envíos.' }
      : {}),
  })
})

server.registerTool('complete_form', {
  description: 'VÍA MÁS RÁPIDA para formulario ya inspeccionado: UNA llamada ejecuta 1–4 fases de operaciones DOM (30 acciones en total), espera brevemente tras cada fase React, verifica hasta 30 campos/etiquetas seleccionadas y, SOLO si el usuario autorizó enviar y TODOS los checks pasan, envía exactamente una vez y lee el resumen real. No usa capturas ni vuelve a enviar si el recibo falla. Para autocompletado: fase 1 fill y fase 2 click de sugerencia con selector+text; checks debe incluir el chip seleccionado, no el valor borrador del input. La respuesta distingue envío intentado de recibo confirmado. Para tareas simples NO hagas 10+ turnos de inspect/fill/verify/click/submit/wait por separado; inspecciona una vez y llama complete_form. Firma mínima ejecutable: {"phases":[[{"operation":"fill","selector":"#taskInput","value":"Preparar café"}]],"checks":[{"operation":"verify","selector":"#taskInput","value":"Preparar café"}]}. `checks` siempre es un array no vacío y cada elemento debe llevar `operation:"verify"`; no uses `fields`, `actions` ni `checks:[]`. Solo añade `submit:{"selector":"#taskForm","confirmation":true}` si el usuario autorizó el envío; `submit:false` no es válido.',
  inputSchema: {
    tabId: z.string().optional(), sessionId: z.string().optional(),
    phases: z.array(z.array(fieldAction).min(1).max(30)).min(1).max(4)
      .refine(phases => phases.reduce((sum, phase) => sum + phase.length, 0) <= 30,
        'El flujo admite hasta 30 acciones en total')
      .describe('Fases ordenadas de acciones DOM. Ejemplo: [[{"operation":"fill","selector":"#taskInput","value":"Preparar café"}]].'),
    checks: z.array(z.object({
      ...targetSchema,
      operation: z.literal('verify'),
      value: z.string().max(4096).optional(),
      checked: z.boolean().optional(),
    })).min(1).max(30)
      .describe('Comprobaciones obligatorias y no vacías. Cada elemento debe llevar operation:"verify"; comprueba el valor o la etiqueta/chip confirmado.'),
    submit: z.object({
      selector: z.string().trim().min(1).max(500),
      confirmation: z.literal(true),
    }).optional().describe('Opcional y solo con autorización explícita: {selector, confirmation:true}. Nunca uses false ni un booleano.'),
    expectedReceiptText: z.string().trim().min(2).max(200).optional(),
  },
}, async ({ tabId, phases, checks, submit, expectedReceiptText, sessionId }) => {
  ensureBrowserActionPermission()
  const tab = await selectedTab(tabId, sessionId)
  const workflow = {
    phases: phases as BrowserInteraction[][],
    checks: checks as BrowserInteraction[],
    ...(submit ? { submit } : {}),
    ...(expectedReceiptText ? { expectedReceiptText } : {}),
  }
  const result = await runBrowserFormWorkflow(workflow, expression => evaluate(tab, expression))
  if (result.ok && (result.stage === 'verified'
    || (result.stage === 'receipt' && result.receiptConfirmed))) {
    // Only proven verification promotes reusable, secret-free locator hints.
    await saveVerifiedFormLayout(tab.url, workflow.phases, workflow.checks).catch(() => false)
  }
  return formatBrowserResult(result)
})

// Transient layout-only candidates. Raw user entries are never stored here.
// A layout is promoted only after a successful verify_form on the same route.
const pendingFormLayouts = new Map<string, { pageKey: string; steps: BrowserInteraction[] }>()
server.registerTool('fill_form', {
  description: 'VÍA PREFERIDA Y RÁPIDA para encuestas/formularios: tras UNA inspección inspect_page, completa hasta 30 campos en UNA sola llamada Chromium DOM (sin capturas ni clics por campo). Usa name, label, CSS o placeholder. Verifica cada escritura inmediatamente, rechaza campos protegidos/ambiguos y se detiene ante un error. Después usa verify_form UNA VEZ para comprobar persistencia; captura pantalla solo si el DOM no alcanza. No envía el formulario.',
  inputSchema: { tabId: z.string().optional(), sessionId: z.string().optional(), fields: z.array(fieldAction).min(1).max(30) },
}, async ({ tabId, fields, sessionId }) => {
  ensureBrowserActionPermission()
  const tab = await selectedTab(tabId, sessionId)
  const result = await evaluate(tab, browserBatchExpression(fields as BrowserInteraction[]))
  if ((result as { ok?: boolean } | undefined)?.ok === true) {
    const hints = sanitizeFormLayout(
      [fields as BrowserInteraction[]],
      fields.map(field => ({
        operation: 'verify' as const, ...(field.selector ? { selector: field.selector } : {}),
        ...(field.name ? { name: field.name } : {}),
      })),
    )
    if (hints !== undefined) {
      const steps = hints.steps.map(step => ({ ...step } as BrowserInteraction))
      pendingFormLayouts.set(tab.id, { pageKey: formLayoutKey(tab.url), steps })
    }
  } else {
    pendingFormLayouts.delete(tab.id)
  }
  return formatBrowserResult(result)
})

server.registerTool('verify_form', {
  description: 'Comprueba de UNA VEZ hasta 30 campos, sin capturas ni exponer valores. Para autocompletados con etiquetas (por ejemplo Subjects), NO basta verificar el valor del input: usa selector CSS único de la etiqueta/chip seleccionada y value esperado; así se valida que la opción quedó realmente confirmada ANTES de enviar. Informa el primer error y protege contraseñas y campos ocultos.',
  inputSchema: {
    tabId: z.string().optional(), sessionId: z.string().optional(),
    fields: z.array(z.object({
      ...targetSchema,
      operation: z.literal('verify'),
      value: z.string().max(4096).optional(),
      checked: z.boolean().optional(),
    })).min(1).max(30),
  },
}, async ({ tabId, fields, sessionId }) => {
  const tab = await selectedTab(tabId, sessionId)
  const result = await evaluate(tab, browserBatchExpression(fields as BrowserInteraction[]))
  if ((result as { ok?: boolean } | undefined)?.ok === true) {
    const remembered = pendingFormLayouts.get(tab.id)
    const steps = remembered?.pageKey === formLayoutKey(tab.url) ? remembered.steps : []
    await saveVerifiedFormLayout(tab.url, [steps], fields as BrowserInteraction[]).catch(() => false)
  }
  pendingFormLayouts.delete(tab.id)
  return formatBrowserResult(result)
})

server.registerTool('fill_learned_form', {
  description: 'Rellena un formulario visitado antes usando localizadores SIN VALORES que fueron aprendidos después de una verificación exitosa. Aporta solo valores ACTUALES, por ejemplo fields:[{"field":"#candidate","value":"Nuevo nombre"},{"field":"department","value":"Ventas"}]. Detecta desajustes DOM y verifica todo en la misma llamada; nunca reutiliza respuestas pasadas ni envía la página. Si no hay memoria o falló la comprobación, usa inspect_page y complete_form.',
  inputSchema: {
    tabId: z.string().optional(), sessionId: z.string().optional(),
    fields: z.array(z.object({
      field: z.string().min(1).max(80),
      value: z.string().max(4096).optional(),
      checked: z.boolean().optional(),
    })).min(1).max(30),
  },
}, async ({ tabId, fields, sessionId }) => {
  ensureBrowserActionPermission()
  const tab = await selectedTab(tabId, sessionId)
  const layout = await recallVerifiedFormLayout(tab.url)
  if (!layout) return formatBrowserResult({
    ok: false, reason: 'NO_VERIFIED_LAYOUT',
    next: 'Inspecciona una vez y usa complete_form o fill_form/verify_form para aprender la estructura.',
  })
  const definedFields = fields.map(({ field, value, checked }) => ({
    field,
    ...(value === undefined ? {} : { value }),
    ...(checked === undefined ? {} : { checked }),
  }))
  const workflow = prepareLearnedFormWorkflow(layout, definedFields)
  if (!workflow) return formatBrowserResult({ ok: false, reason: 'LEARNED_LAYOUT_FIELD_MISMATCH',
    next: 'No hay un localizador seguro para todos los campos actuales; vuelve a inspect_page.' })
  const inspect = await evaluate(tab, browserInteractionExpression({ operation: 'inspect' })) as BrowserInteractionResult
  const controls = Array.isArray(inspect?.controls) ? inspect.controls as Array<{
    id?: string; name?: string; visible?: boolean; disabled?: boolean; readonly?: boolean; type?: string
  }> : []
  const matches = workflow.phases.flat().every(action => {
    const match = controls.filter(control => control.visible && !control.disabled && !control.readonly
      && control.type !== 'password' && (action.name !== undefined
        ? control.name === action.name
        : action.selector?.startsWith('#') && control.id === action.selector.slice(1)))
    return match.length === 1
  })
  if (!matches) return formatBrowserResult({
    ok: false, reason: 'LEARNED_LAYOUT_STALE',
    next: 'Un localizador guardado ya no coincide con un control único y editable; inspecciona el DOM antes de escribir.',
  })
  const result = await runBrowserFormWorkflow(workflow, expression => evaluate(tab, expression))
  return formatBrowserResult(result)
})

server.registerTool('interact', {
  description: 'Control estructurado de elementos visibles en Chromium sin JavaScript arbitrario. Para sugerencias de autocompletado, combina selector CSS acotado (ej. button o [role=option]) con text EXACTO (ej. Maths) para distinguir la sugerencia de la caja de texto; luego verifica la etiqueta/chip en verify_form antes de enviar. No resuelvas opciones ambiguas a ciegas.',
  inputSchema: { tabId: z.string().optional(), sessionId: z.string().optional(), ...targetSchema,
    operation: z.enum(['fill', 'select', 'check', 'click', 'scroll']),
    value: z.string().max(4096).optional(), checked: z.boolean().optional() },
}, async ({ tabId, sessionId, ...input }) => {
  ensureBrowserActionPermission()
  return formatBrowserResult(await evaluate(await selectedTab(tabId, sessionId), browserInteractionExpression(input as BrowserInteraction)))
})

server.registerTool('submit_form', {
  description: 'Envía SOLO con autorización explícita. Previamente verifica TODOS los campos incluidos los tags/autocompletados confirmados (texto en input NO es tag). Un recibo de envío no implica corrección de datos; comprueba el resumen real. No reenvíes automáticamente para reparar un campo faltante: detente, informa la omisión y solicita nueva autorización cuando corresponda. No usar para acciones sensibles sin confirmación.',
  inputSchema: { tabId: z.string().optional(), sessionId: z.string().optional(), ...targetSchema,
    confirmation: z.literal(true) },
}, async ({ tabId, confirmation, sessionId, ...target }) => {
  ensureBrowserActionPermission()
  if (!confirmation) throw new Error('Se requiere confirmación del usuario para enviar el formulario.')
  const tab = await selectedTab(tabId, sessionId)
  return formatBrowserResult(await evaluate(tab, browserInteractionExpression({ ...target, operation: 'submit' })))
})

server.registerTool('wait_for', {
  description: 'Espera hasta 8 segundos el texto visible de confirmación tras navegar o enviar un formulario. Consulta el DOM real con pocas comprobaciones; no repite el envío. Informa texto encontrado o timeout y URL final verificada.',
  inputSchema: {
    tabId: z.string().optional(), sessionId: z.string().optional(), expectedText: z.string().min(1).max(250),
    timeoutMs: z.number().int().min(200).max(8000).default(5000),
  },
}, async ({ tabId, expectedText, timeoutMs, sessionId }) => {
  const tab = await selectedTab(tabId, sessionId)
  const deadline = Date.now() + timeoutMs
  let last: BrowserInteractionResult | undefined
  do {
    try {
      last = await evaluate(tab, browserInteractionExpression({ operation: 'wait', expectedText })) as BrowserInteractionResult
      if (last?.ok) return formatBrowserResult(last)
    } catch {
      // A form submit may invalidate its old JavaScript context during
      // navigation. Retry reading the new page, never replay the submit.
    }
    if (Date.now() >= deadline) break
    await new Promise(resolve => setTimeout(resolve, 250))
  } while (Date.now() < deadline)
  return formatBrowserResult({ ok: false, reason: 'TIMEOUT_WAITING_FOR_TEXT', url: last?.url, title: last?.title, foundText: false })
})


type YoutubeInspectionMetadata = {
  readonly url: string
  readonly title: string
  readonly author: string
  readonly description: string
  readonly durationSeconds: number
  readonly tracks: YoutubeCaptionTrack[]
  readonly hasVideoElement: boolean
}

/** Inspect the public player's exposed metadata, not cookies or user storage. */
async function inspectYoutubeMetadata(tab: Tab): Promise<YoutubeInspectionMetadata> {
  const expression = '(() => { '
    + 'const data = window.ytInitialPlayerResponse || document.querySelector("#movie_player")?.getPlayerResponse?.(); '
    + 'const details = data?.videoDetails; '
    + 'const captions = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks; '
    + 'return JSON.stringify({ url: location.href, title: String(details?.title || document.title || ""), '
    + 'author: String(details?.author || ""), description: String(details?.shortDescription || "").slice(0, 1600), '
    + 'durationSeconds: Number(details?.lengthSeconds) || 0, hasVideoElement: !!document.querySelector("video"), '
    + 'tracks: (Array.isArray(captions) ? captions : []).map(t => ({ baseUrl: String(t.baseUrl || ""), '
    + 'languageCode: String(t.languageCode || ""), kind: String(t.kind || ""), '
    + 'name: String(t.name?.simpleText || "") })) }); })()'
  const result = await evaluate(tab, expression)
  return JSON.parse(String(result)) as YoutubeInspectionMetadata
}

/** Only read public YouTube timed-text from the video tab's own origin. */
async function youtubeCaptionDocument(tab: Tab, rawUrl: string): Promise<string> {
  const address = new URL(youtubeCaptionUrl(rawUrl))
  address.searchParams.set('fmt', 'json3')
  const js = '(async () => { const response = await fetch(' + JSON.stringify(address.href)
    + ', { credentials: "same-origin" }); if (!response.ok) return ""; '
    + 'const text = await response.text(); return text.length <= 2000000 ? text : ""; })()'
  const response = await evaluate(tab, js)
  if (typeof response === 'string' && response.length > 0) return response
  // Some tracks are XML-only. The original signed endpoint is the fallback.
  const xml = '(async () => { const response = await fetch(' + JSON.stringify(youtubeCaptionUrl(rawUrl))
    + ', { credentials: "same-origin" }); if (!response.ok) return ""; '
    + 'const text = await response.text(); return text.length <= 2000000 ? text : ""; })()'
  const fallback = await evaluate(tab, xml)
  return typeof fallback === 'string' ? fallback : ''
}

/** Capture true decoded Chromium video frames, never fabricated image assets. */
async function youtubeSampleFrame(tab: Tab, requestedSeconds: number): Promise<
  { readonly atSeconds: number; readonly jpeg: string } | undefined
> {
  const expression = '(async () => { const video = document.querySelector("video"); '
    + 'if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return JSON.stringify({ok:false}); '
    + 'const originalMuted = video.muted; video.pause(); const seconds = ' + String(requestedSeconds) + '; '
    + 'await Promise.race([new Promise(resolve => { video.addEventListener("seeked", resolve, {once:true}); video.currentTime = seconds; }), '
    + 'new Promise(resolve => setTimeout(resolve, 1600))]); '
    + 'try { video.muted = true; await video.play(); await new Promise(resolve => setTimeout(resolve, 400)); } '
    + 'catch { /* YouTube can deny autoplay; a decoded seek may still be captured. */ } '
    + 'finally { video.pause(); video.muted = originalMuted; } '
    + 'return JSON.stringify({ok: video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0 '
    + '&& Math.abs(video.currentTime - seconds) < 3, atSeconds: video.currentTime}); })()'
  const result = JSON.parse(String(await evaluate(tab, expression))) as { ok?: boolean; atSeconds?: number }
  if (!result.ok || typeof result.atSeconds !== 'number') return
  const shot = await cdp<{ data: string }>(tab, 'Page.captureScreenshot', {
    format: 'jpeg', quality: 65, fromSurface: true, captureBeyondViewport: false,
  })
  const bytes = typeof shot.data === 'string' ? Buffer.from(shot.data, 'base64') : Buffer.alloc(0)
  if (bytes.length < 64 || bytes.length > 5_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return
  return { atSeconds: result.atSeconds, jpeg: shot.data }
}


/**
 * Transcribe real decoded tab audio locally. Requires permission for playback
 * and an accessible Chrome captureStream audio track. Returns NO audio bytes.
 */
async function sampleYoutubeSpeech(tab: Tab, startSeconds: number, seconds: number): Promise<{
  status: 'ok' | 'unavailable'
  reason?: string
  language?: string
  transcript?: string
  cueCount?: number
  sampleStartSeconds?: number
  sampleDurationSeconds?: number
}> {
  try {
    const captured = parseCapturedVideoAudio(await evaluate(
      tab, videoAudioCaptureExpression(startSeconds, seconds), 22_000,
    ))
    if (!captured.ok) return { status: 'unavailable', reason: captured.reason ?? 'AUDIO_CAPTURE_UNAVAILABLE' }
    const transcribed = await transcribeCapturedVideoAudio(captured)
    const lines = transcribed.cues
      .map(cue => '[' + (cue.start + (captured.startSeconds ?? startSeconds)).toFixed(2)
        + 's] ' + cue.text).join('\n').slice(0, 16_000)
    return {
      status: lines.length > 0 ? 'ok' : 'unavailable',
      ...(lines.length > 0 ? { transcript: lines } : { reason: 'NO_RECOGNIZABLE_SPEECH' }),
      ...(transcribed.language === undefined ? {} : { language: transcribed.language }),
      cueCount: transcribed.cues.length,
      ...(captured.startSeconds === undefined ? {} : { sampleStartSeconds: captured.startSeconds }),
      ...(captured.durationSeconds === undefined ? {} : { sampleDurationSeconds: captured.durationSeconds }),
    }
  } catch (error) {
    return { status: 'unavailable', reason: String(error).slice(0, 180) }
  }
}

server.registerTool('youtube_video_listen', {
  description: 'ESCUCHA audio real del video público y transcribe localmente con faster-whisper. Procesa un segmento de 3-9 s del Chromium ya abierto; repite por tramos hasta cubrir el contenido solicitado, sin inventar lo no escuchado. Auto-instala el motor vía uv y usa CPU sin API de pago. Requiere permiso de acciones y una pista de audio capturable. No descarga videos ni intenta evadir DRM; devuelve la limitación específica cuando el navegador bloquea audio.',
  inputSchema: {
    url: z.url().optional(),
    tabId: z.string().optional(), sessionId: z.string().optional(),
    startSeconds: z.number().min(0).max(86400).default(0),
    durationSeconds: z.number().int().min(3).max(9).default(8),
  },
}, async ({ url, tabId, startSeconds, durationSeconds, sessionId }) => {
  ensureBrowserActionPermission()
  const tab = url === undefined ? await selectedTab(tabId, sessionId) : await newBrowserTab(youtubeWatchUrl(url, sessionId))
  const expected = youtubeWatchUrl(url ?? tab.url)
  let verified = false
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const info = await inspectYoutubeMetadata(tab)
      if (youtubeWatchUrl(info.url) !== expected) throw new Error('VIDEO_URL_MISMATCH')
      if (info.hasVideoElement) { verified = true; break }
    } catch { /* Wait for the player to initialize. */ }
    await new Promise(resolve => setTimeout(resolve, 450))
  }
  if (!verified) return { isError: true, content: [{ type: 'text', text: 'El reproductor público no ofrece un elemento de video listo para captura.' }] }
  const speech = await sampleYoutubeSpeech(tab, startSeconds, durationSeconds)
  return { content: [{ type: 'text', text: JSON.stringify({
    url: expected, browserTabId: tab.id,
    source: 'real Chrome MediaRecorder + local faster-whisper',
    ...speech,
    nextStartSeconds: speech.status === 'ok' ? (speech.sampleStartSeconds ?? startSeconds) + durationSeconds : undefined,
    note: speech.status === 'ok'
      ? 'Esta transcripción abarca solamente el fragmento indicado, no el video completo. Continúa por segmentos cuando la tarea lo requiera.'
      : 'No fue posible escuchar este segmento de forma comprobable; no inventes contenido.',
  }) }], ...(speech.status === 'ok' ? {} : { isError: true as const }) }
})


/**
 * Independent evidence path when YouTube blocks its headless CDP player.
 * Human must first share a real browser tab through Phoenix's native Chrome
 * chooser, or explicitly allow a local media directory; never bypass DRM.
 */
server.registerTool('video_media_inspect', {
  description: 'Analiza audio y fotogramas reales de una grabación de pestaña previamente autorizada desde el MiniBrowser (botón «Compartir pestaña para Kira»), o un archivo local dentro de PHOENIX_VIDEO_ALLOWED_DIRS. Usa FFmpeg y Whisper locales, sin depender de YouTube. Si falla youtube_video_inspect, pide primero al usuario seleccionar una pestaña y activar «Compartir audio»; después usa esta herramienta sin path. Nunca busques descargas no autorizadas ni supongas haber oído el contenido antes de obtener evidencia.',
  inputSchema: {
    path: z.string().optional(),
    frames: z.number().int().min(0).max(8).default(6),
    audioSeconds: z.number().int().min(0).max(90).default(45),
  },
}, async ({ path,frames,audioSeconds }) => {
  try {
    const media = await inspectVideoMedia({
      ...(path === undefined ? {} : { path }),
      frames, audioSeconds,
    })
    const content: Array<
      | { type:'text';text:string }
      | { type:'image';data:string;mimeType:'image/jpeg' }
    > = [{
      type: 'text',
      text: JSON.stringify({
        source: media.source,
        durationSeconds: media.durationSeconds,
        evidenceFrames: media.frames.length,
        audio: media.audio,
        note: 'Solo se analizó el audio solicitado y los fotogramas adjuntos. No inferir partes no examinadas. No descargar videos de terceros.',
      }),
    }]
    for (const image of media.frames) {
      content.push({ type:'text',text:'Fotograma decodificado del segundo '+String(image.atSeconds) })
      content.push({ type:'image',data:image.jpeg,mimeType:'image/jpeg' })
    }
    return { content, ...(media.frames.length === 0 && media.audio.status !== 'ok' ? { isError:true as const } : {}) }
  } catch (error) {
    const reason = String(error)
    const captureRequired = /VIDEO_CAPTURE_NOT_FOUND|VIDEO_CAPTURE_EXPIRED_OR_INVALID|VIDEO_CAPTURE_PATH_INVALID/u.test(reason)
    return { isError:true,content:[{ type:'text',text:JSON.stringify({
      status: captureRequired ? 'user_capture_required' : 'analysis_failed',
      reason,
      requiredAction: captureRequired
        ? 'Desde el MiniBrowser pulsa «Compartir pestaña para Kira», elige en Chrome la pestaña donde el video realmente se reproduce, activa «Compartir audio» y deja terminar hasta 30 segundos de captura. Después vuelve a ejecutar video_media_inspect SIN path.'
        : 'Revisa el motivo técnico o usa un archivo de medios propio dentro de PHOENIX_VIDEO_ALLOWED_DIRS.',
      evidence: { heardSeconds:0,decodedFrames:0 },
      rule: 'No simules haber escuchado o visto el video. Si falta la grabación autorizada, solicita el paso humano y detente: no presentes una valoración del contenido no examinado.',
    }) }] }
  }
})

server.registerTool('youtube_video_inspect', {
  description: 'Analiza video público real de YouTube, con hasta 12 fotogramas Chromium, subtítulos temporizados y un intento de escuchar hasta 9 segundos mediante faster-whisper local cuando faltan subtítulos. Para otros fragmentos usa youtube_video_listen en la misma pestaña. No declara haber oído partes sin captura; respeta permisos, DRM y bloqueo de reproducción, sin descargas ni API de pago.',
  inputSchema: {
    url: z.url().optional(),
    tabId: z.string().optional(), sessionId: z.string().optional(),
    maxChars: z.number().int().min(1000).max(80000).default(45000),
    frames: z.number().int().min(0).max(12).default(6),
    audioSeconds: z.number().int().min(0).max(9).default(8),
  },
}, async ({ url, tabId, maxChars, frames, audioSeconds, sessionId }) => {
  let tab: Tab
  let expectedVideoUrl: string
  if (url !== undefined) {
    expectedVideoUrl = youtubeWatchUrl(url)
    ensureBrowserActionPermission()
    tab = await newBrowserTab(expectedVideoUrl, sessionId)
  } else {
    tab = await selectedTab(tabId, sessionId)
    expectedVideoUrl = youtubeWatchUrl(tab.url)
  }

  let metadata: YoutubeInspectionMetadata | undefined
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const inspected = await inspectYoutubeMetadata(tab)
      if (youtubeWatchUrl(inspected.url) !== expectedVideoUrl) {
        throw new Error('YouTube redirigió fuera del video solicitado.')
      }
      metadata = inspected
      if (inspected.hasVideoElement || inspected.tracks.length > 0) break
    } catch (error) {
      if (attempt === 7) return {
        isError: true,
        content: [{ type: 'text', text: 'No se pudo leer el video público de YouTube: ' + String(error) }],
      }
    }
    await new Promise(resolve => setTimeout(resolve, 450))
  }
  if (metadata === undefined) return {
    isError: true, content: [{ type: 'text', text: 'YouTube no expuso metadatos verificables para este video.' }],
  }

  const track = chooseYoutubeCaptions(metadata.tracks)
  let transcript = { text: '', cues: 0, truncated: false }
  let captionError: string | undefined
  if (track !== undefined) {
    try {
      transcript = youtubeTranscript(await youtubeCaptionDocument(tab, track.baseUrl), maxChars)
      if (transcript.cues === 0) captionError = 'YouTube no entregó texto para la pista seleccionada.'
    } catch (error) {
      captionError = 'No se pudo leer la pista de subtítulos: ' + String(error)
    }
  } else captionError = 'El reproductor no ofrece pistas de subtítulos accesibles.'

  // If YouTube captions are missing, attempt actual browser audio + local ASR.
  // Never claim to have listened beyond the explicitly sampled seconds.
  const sampledSpeech = transcript.cues === 0 && audioSeconds >= 3 && actionsAllowed()
    && metadata.hasVideoElement
    ? await sampleYoutubeSpeech(tab, 0, audioSeconds)
    : undefined
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: 'image/jpeg' }
  > = [{
    type: 'text',
    text: JSON.stringify({
      source: 'YouTube public player + actual timed-text; not inferred speech',
      url: expectedVideoUrl,
      title: metadata.title,
      author: metadata.author,
      durationSeconds: metadata.durationSeconds,
      description: metadata.description,
      availableCaptionTracks: metadata.tracks.map(item => ({ language: item.languageCode, type: item.kind || 'manual' })),
      chosenCaptionLanguage: track?.languageCode,
      transcript: transcript.text,
      transcriptCueCount: transcript.cues,
      transcriptTruncated: transcript.truncated,
      captionLimitation: captionError,
      audioSample: sampledSpeech ?? (transcript.cues === 0 ? { status: 'unavailable', reason: 'BROWSER_ACTION_PERMISSION_REQUIRED_OR_AUDIO_DISABLED' } : undefined),
      audioNextStep: 'Si funciona la captura interna, youtube_video_listen amplía los segmentos. Si falla el reproductor o expira el audio, usa la captura autorizada de pestaña del MiniBrowser y después video_media_inspect para analizar audio y fotogramas reales.',
      videoFrameMethod: 'real Chromium video seek + screenshot; the audio sample is locally transcribed only if confirmed',
      browserTabId: tab.id,
    }),
  }]
  if (frames > 0 && actionsAllowed() && metadata.hasVideoElement && metadata.durationSeconds > 0) {
    for (let index = 0; index < frames; index++) {
      const seconds = Math.max(1, Math.floor(metadata.durationSeconds * (index + 1) / (frames + 1)))
      try {
        const sample = await youtubeSampleFrame(tab, seconds)
        if (sample) {
          content.push({ type: 'text', text: 'Fotograma real del video en segundo ' + String(sample.atSeconds) })
          content.push({ type: 'image', data: sample.jpeg, mimeType: 'image/jpeg' })
        }
      } catch { /* A seek or screenshot may be blocked even when captions work. */ }
    }
  }
  const realFrames = content.filter(part => part.type === 'image').length
  content.push({ type: 'text', text: 'Fotogramas capturados: ' + String(realFrames) + '/'
    + String(frames) + '. ' + (frames > 0 && !actionsAllowed()
    ? 'La inspección visual requiere permiso para controlar el navegador.'
    : realFrames === 0 && frames > 0 ? 'El reproductor no permitió extraer fotogramas verificables; ofrece captura autorizada de pestaña y video_media_inspect.' : '')
    + ' No afirmar que se escuchó el video entero; cada segmento de audio y fotograma debe tener evidencia.' })
  return { content, ...(transcript.cues === 0 && sampledSpeech?.status !== 'ok' && realFrames === 0
    ? { isError: true as const } : {}) }
})

server.registerTool('screenshot', {
  description: 'Vista visual REAL de Chromium (JPEG 1280x720) únicamente cuando la inspección DOM no sea suficiente. Permite reconocer canvas, menús, diseños, errores y diálogos web. Puede costar más tokens que inspect_page; evita capturas repetidas.',
  inputSchema: { tabId: z.string().optional(), sessionId: z.string().optional() },
}, async ({ tabId, sessionId }) => {
  const tab = await selectedTab(tabId, sessionId)
  const shot = await cdp<{ data: string }>(tab, 'Page.captureScreenshot', {
    format: 'jpeg', quality: 65, captureBeyondViewport: false, fromSurface: true,
  })
  const bytes = typeof shot.data === 'string' ? Buffer.from(shot.data, 'base64') : Buffer.alloc(0)
  if (bytes.length < 64 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.length > 5_000_000) {
    return { isError: true, content: [{ type: 'text', text: 'CAPTURE_FAILED: Chromium no proporcionó un JPEG verificable.' }] }
  }
  return { content: [
    { type: 'image' as const, data: shot.data, mimeType: 'image/jpeg' as const },
    { type: 'text' as const, text: 'Captura real de ' + tab.url + ' (1280x720, sin clip). Usa inspect_page primero para formularios.' },
  ] }
})

server.registerTool('mouse_action', {
  description: 'Control visual alternativo sobre una captura REAL de Chromium: clic o desplazamiento en coordenadas 1280x720. Úsalo solo si no existe control DOM accesible; nunca hagas clic a ciegas sin una captura reciente.',
  inputSchema: { tabId: z.string().optional(), sessionId: z.string().optional(), action: z.enum(['click','scroll']),
    x: z.number().min(0).max(1280), y: z.number().min(0).max(720),
    deltaY: z.number().min(-1500).max(1500).optional() },
}, async ({ tabId, action, x, y, deltaY, sessionId }) => {
  ensureBrowserActionPermission()
  const tab = await selectedTab(tabId, sessionId)
  if (action === 'scroll') {
    await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: deltaY ?? 480 })
  } else {
    await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  return { content: [{ type: 'text', text: 'Acción enviada al Chromium real, pestaña ' + tab.id
    + '. Verifica con inspect_page o screenshot antes de afirmar el resultado.' }] }
})

/** Parse keyboard shorthand without executing page scripts or accessing the clipboard. */
export interface NormalizedBrowserKey {
  key: string
  code: string
  virtualKeyCode: number
  modifiers: number
  text?: string
}
const BROWSER_MODIFIERS: Readonly<Record<string, number>> = {
  alt: 1, option: 1, ctrl: 2, control: 2, ctl: 2,
  meta: 4, cmd: 4, command: 4, shift: 8,
}
const BROWSER_KEY_NAMES: Readonly<Record<string, readonly [string, string, number]>> = {
  enter: ['Enter', 'Enter', 13], return: ['Enter', 'Enter', 13],
  tab: ['Tab', 'Tab', 9],
  escape: ['Escape', 'Escape', 27], esc: ['Escape', 'Escape', 27],
  backspace: ['Backspace', 'Backspace', 8],
  delete: ['Delete', 'Delete', 46], del: ['Delete', 'Delete', 46],
  arrowup: ['ArrowUp', 'ArrowUp', 38], up: ['ArrowUp', 'ArrowUp', 38],
  arrowdown: ['ArrowDown', 'ArrowDown', 40], down: ['ArrowDown', 'ArrowDown', 40],
  arrowleft: ['ArrowLeft', 'ArrowLeft', 37], left: ['ArrowLeft', 'ArrowLeft', 37],
  arrowright: ['ArrowRight', 'ArrowRight', 39], right: ['ArrowRight', 'ArrowRight', 39],
  home: ['Home', 'Home', 36], end: ['End', 'End', 35],
  pageup: ['PageUp', 'PageUp', 33], pgup: ['PageUp', 'PageUp', 33],
  pagedown: ['PageDown', 'PageDown', 34], pgdn: ['PageDown', 'PageDown', 34],
  space: [' ', 'Space', 32], spacebar: [' ', 'Space', 32], espacio: [' ', 'Space', 32],
  f3: ['F3', 'F3', 114], f5: ['F5', 'F5', 116],
}
function parseBrowserModifier(value: string): number {
  let bitmask = 0
  for (const part of value.split(/[+,\s]+/u).filter(Boolean)) {
    const mask = BROWSER_MODIFIERS[part.toLowerCase()]
    if (mask === undefined) throw new TypeError('Unknown modifier')
    bitmask |= mask
  }
  return bitmask
}
export function normalizeBrowserKey(key: string, modifiers: number | string | string[] = 0): NormalizedBrowserKey {
  const raw = key.trim()
  if (!raw) {
    if (key === ' ') return { key: ' ', code: 'Space', virtualKeyCode: 32, modifiers: 0, text: ' ' }
    throw new TypeError('Empty key')
  }
  const parts = raw.split(/\s*\+\s*/u)
  const basic = parts.pop()?.trim()
  if (!basic) throw new TypeError('Missing final key')
  const embeddedModifiers = parts.length === 0 ? 0 : parseBrowserModifier(parts.join('+'))
  const explicit = typeof modifiers === 'number' ? modifiers
    : parseBrowserModifier(Array.isArray(modifiers) ? modifiers.join('+') : modifiers)
  if (!Number.isInteger(explicit) || explicit < 0 || explicit > 15) throw new TypeError('Invalid modifier mask')
  const mask = embeddedModifiers | explicit
  const alias = basic.toLowerCase().replace(/\s/gu, '')
  const named = BROWSER_KEY_NAMES[alias]
  if (named !== undefined) {
    const [name, code, virtual] = named
    return { key: name, code, virtualKeyCode: virtual, modifiers: mask,
      ...(mask === 0 && name === ' ' ? { text: ' ' } : {}) }
  }
  if (!/^[a-z0-9]$/iu.test(basic)) throw new TypeError('Unsupported browser key')
  const digit = /^[0-9]$/u.test(basic)
  const virtualKeyCode = basic.toUpperCase().charCodeAt(0)
  return { key: basic, code: (digit ? 'Digit' : 'Key') + basic.toUpperCase(),
    virtualKeyCode, modifiers: mask, ...(mask === 0 ? { text: basic } : {}) }
}

server.registerTool('press_key', {
  description: 'Enviar tecla en la pestaña actual con sintaxis flexible. Ejemplos: {"key":"PageDown"}, {"key":"Shift+Tab"}, {"key":"Ctrl+F"}, {"key":"Space"}. modifiers acepta entero de bits, "Ctrl+Shift" o ["Control","Shift"]. Usa interact para controles DOM y comprueba cualquier cambio antes de afirmar éxito.',
  inputSchema: { tabId: z.string().optional(), sessionId: z.string().optional(), key: z.string().min(1).max(60),
    modifiers: z.union([z.number().int().min(0).max(15), z.string(), z.array(z.string())]).optional() },
}, async ({ tabId, key, modifiers, sessionId }) => {
  ensureBrowserActionPermission()
  let normalized: NormalizedBrowserKey
  try {
    normalized = normalizeBrowserKey(key, modifiers)
  } catch {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({
      code: 'INVALID_BROWSER_KEY',
      expected: { key: 'PageDown | Shift+Tab | Ctrl+F | Space | End', modifiers: 'optional' },
      next: 'Corrige el formato de key o utiliza inspect_page e interact para un control DOM real.',
    }) }] }
  }
  const tab = await selectedTab(tabId, sessionId)
  const params = {
    key: normalized.key, code: normalized.code, modifiers: normalized.modifiers,
    windowsVirtualKeyCode: normalized.virtualKeyCode, nativeVirtualKeyCode: normalized.virtualKeyCode,
  }
  await cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params,
    ...(normalized.text === undefined ? {} : { text: normalized.text }) })
  await cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  return { content: [{ type: 'text', text: JSON.stringify({
    status: 'dispatched', key: normalized.key, modifiers: normalized.modifiers, tabId: tab.id,
    verified: false, next: 'Comprueba el cambio real con inspect_page; una tecla enviada no prueba avance.',
  }) }] }
})

server.registerTool('type_text', {
  description: 'Escribe texto en el campo actualmente enfocado del Chromium del chat mediante CDP, sin ventana visible. Inspecciona y enfoca antes: no escribir a ciegas. Para formularios normales usar fill_form es más rápido y fiable.',
  inputSchema: { tabId: z.string().optional(), sessionId: z.string().optional(), text: z.string().max(4096) },
}, async ({ tabId, text, sessionId }) => {
  ensureBrowserActionPermission()
  const tab = await selectedTab(tabId, sessionId)
  const focused = await evaluate(tab, 'Boolean(document.activeElement && (document.activeElement.matches("input:not([type=hidden]):not([disabled]):not([readonly]),textarea:not([disabled]):not([readonly]),[contenteditable=true]")))')
  if (focused !== true) throw new Error('No hay campo editable enfocado en Chromium. Usa inspect_page e interact primero.')
  await cdp(tab, 'Input.insertText', { text })
  return { content: [{ type: 'text', text: 'Texto introducido en el control enfocado. Verifica en el DOM antes de confirmar.' }] }
})

server.registerTool('click_text', {
  description: 'Hace clic en un elemento cuyo texto coincide cuando la política de permisos del navegador permite acciones.',
  inputSchema: { text: z.string().min(1), tabId: z.string().optional(), sessionId: z.string().optional() },
}, async ({ text, tabId, sessionId }) => {
  if (!actionsAllowed()) throw new Error('Acción bloqueada por la política de permisos del navegador (modo read-only o PHOENIX_BROWSER_ALLOW_ACTIONS=false).')
  const tab = await selectedTab(tabId, sessionId)
  const escaped = JSON.stringify(text)
  const result = await evaluate(tab, `(() => { const wanted=${escaped}; const el=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"]')].find(e => (e.innerText || e.value || '').trim().includes(wanted)); if (!el) return 'No encontrado'; if (el.type === 'submit') return 'Usa submit_form con confirmación explícita'; el.click(); return 'Clic realizado'; })()`)
  return { content: [{ type: 'text', text: String(result) }] }
})

/** Start the local stdio MCP connector. */
export async function startChromeConnector(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
