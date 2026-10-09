/**
 * Local Chromium-browser MCP connector (Chrome or Microsoft Edge).
 *
 * It attaches only to loopback CDP endpoints. When no user-provided endpoint
 * exists, PHOENIX can start a dedicated Chromium instance with an isolated
 * temporary profile; personal Chrome/Edge profile files are never opened.
 * Mutating actions are controlled by Phoenix's permission-derived PHOENIX_BROWSER_ALLOW_ACTIONS policy.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { browserBatchExpression, browserInteractionExpression, type BrowserInteraction, type BrowserInteractionResult } from './browser-interactions.ts'

const DEFAULT_PORTS = [9222, 9223, 9224]
/** User-temp discovery lets the in-chat view reuse this exact Chromium tab. */
const SHARED_BROWSER = join(tmpdir(), 'phoenix-browser-cdp.json')
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
    ...(headless ? ['--headless=new'] : []),
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
type CdpResponse = { id: number; result?: { data?: string; result?: { value?: unknown; description?: string }; exceptionDetails?: { text?: string } }; error?: { message: string } }

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
  if (!response.ok) throw new Error(`El navegador respondió HTTP ${response.status}`)
  return await response.json() as T
}

function cleanupManagedBrowser(): void {
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

async function endpoint(): Promise<string> {
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

async function tabs(): Promise<Tab[]> {
  return (await json<Tab[]>(`${await endpoint()}/json/list`)).filter(tab => tab.type === 'page' || tab.type === undefined)
}

/**
 * A new user navigation owns its own CDP tab; this keeps earlier MiniBrowser
 * cards tied to their original pages when later chat turns open new sites.
 * Explicit tabId still navigates the supplied tab for deliberate reuse.
 */
async function newBrowserTab(url: string): Promise<Tab> {
  const base = await endpoint()
  const result = await fetch(base + '/json/new?' + encodeURIComponent(url), {
    method: 'PUT', signal: AbortSignal.timeout(5000),
  })
  if (!result.ok) throw new Error('No se pudo abrir una pestaña Chromium nueva: HTTP ' + String(result.status))
  const tab = await result.json() as Tab
  if (!tab.id || !tab.webSocketDebuggerUrl) throw new Error('Chrome no devolvió un identificador válido')
  announceSession(base, tab.id)
  return tab
}

async function selectedTab(id?: string): Promise<Tab> {
  const available = await tabs()
  const requestedId = id ?? sharedSession()?.selectedTabId
  const tab = available.find(candidate => candidate.id === requestedId) ?? available[0]
  if (!tab) throw new Error(id ? `No existe la pestaña ${id}` : 'El navegador no tiene pestañas web disponibles')
  if (!tab.webSocketDebuggerUrl) throw new Error('La pestaña no ofrece una conexión CDP')
  announceSession(await endpoint(), tab.id)
  return tab
}

async function cdp<T = unknown>(tab: Tab, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const WebSocketCtor = globalThis.WebSocket
  const debuggerUrl = tab.webSocketDebuggerUrl
  if (!debuggerUrl) throw new Error('La pestaña no ofrece una conexión CDP')
  const socket = new WebSocketCtor(debuggerUrl)
  const id = Math.floor(Math.random() * 2_000_000_000)
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error(`Tiempo agotado ejecutando ${method}`)) }, 10_000)
    // Session-local metrics must precede any screenshot/mouse coordinate action
    // on this SAME CDP socket; an oversized clip on an 800px viewport produced
    // the black half in Phoenix's inline browser.
    const needsViewport = method === 'Page.captureScreenshot' || method === 'Input.dispatchMouseEvent'
    const viewportId = id + 1
    const sendAction = () => { socket.send(JSON.stringify({ id, method, params })) }
    socket.addEventListener('open', () => {
      if (!needsViewport) { sendAction(); return }
      socket.send(JSON.stringify({
        id: viewportId, method: 'Emulation.setDeviceMetricsOverride',
        params: { width: 1280, height: 720, screenWidth: 1280, screenHeight: 720,
          deviceScaleFactor: 1, mobile: false },
      }))
    })
    socket.addEventListener('message', (event) => {
      let message: CdpResponse
      try { message = JSON.parse(String(event.data)) as CdpResponse } catch { return }
      if (needsViewport && message.id === viewportId) {
        if (message.error) { clearTimeout(timer); socket.close(); reject(new Error(message.error.message)) }
        else sendAction()
        return
      }
      if (message.id !== id) return
      clearTimeout(timer); socket.close()
      if (message.error) reject(new Error(message.error.message))
      else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.text || 'Error de ejecución del DOM'))
      else resolve((message.result?.result?.value ?? message.result) as T)
    })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`No se pudo conectar con ${tab.url}`)) })
  })
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

async function evaluate(tab: Tab, expression: string): Promise<unknown> {
  return await cdp(tab, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
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
  description: 'Lista las pestañas web visibles en la sesión Chrome/Edge conectada.',
  inputSchema: {},
}, async () => ({ content: [{ type: 'text', text: JSON.stringify(await tabs(), null, 2) }] }))

server.registerTool('navigate', {
  description: 'Navega una pestaña a una URL HTTP(S). No envía formularios ni ejecuta acciones de cuenta.',
  inputSchema: { url: z.url(), tabId: z.string().optional() },
}, async ({ url, tabId }) => {
  if (!actionsAllowed()) throw new Error('Navegación bloqueada por la política de permisos del navegador (modo read-only o PHOENIX_BROWSER_ALLOW_ACTIONS=false).')
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Solo se permiten URLs HTTP(S)')
  const tab = tabId === undefined ? await newBrowserTab(url) : await selectedTab(tabId)
  // /json/new already navigates the new page, while an explicit tabId must
  // navigate the user's chosen existing tab.
  if (tabId !== undefined) await cdp(tab, 'Page.navigate', { url })
  return { content: [{ type: 'text', text: `Navegación iniciada en ${url} (pestaña ${tab.id})` }] }
})

server.registerTool('youtube_search', {
  description: 'Acción rápida: abre YouTube directamente en los resultados de búsqueda de la frase solicitada, usando la sesión de Chrome/Edge y sus permisos actuales. Úsala en UNA sola llamada para peticiones como "abre YouTube y busca Bob Esponja"; no hace falta status, tabs, navigate, click_text, read_page, navegador adicional, subagentes ni review profundo. Tras una comprobación breve de URL, informa el resultado real y termina; no reproduzcas un video si no te lo pidieron. Si falta autorización, informa la restricción una vez, no repitas intentos.',
  inputSchema: { query: z.string().trim().min(1).max(256), tabId: z.string().optional() },
}, async ({ query, tabId }) => {
  const url = youtubeSearchUrl(query)
  if (!actionsAllowed()) {
    return { isError: true, content: [{ type: 'text', text: `Navegación no autorizada por la política actual. No se abrió YouTube. Enlace directo para el usuario: ${url}. No repitas ni eludas el permiso; informa este bloqueo una sola vez.` }] }
  }
  let tab: Tab
  try {
    tab = tabId === undefined ? await newBrowserTab(url) : await selectedTab(tabId)
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
  const current = await tabs().then(rows => rows.find(candidate => candidate.id === tab.id), () => undefined)
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
  inputSchema: { tabId: z.string().optional(), maxChars: z.number().int().min(1).max(100000).default(30000) },
}, async ({ tabId, maxChars }) => {
  const tab = await selectedTab(tabId)
  const value = await evaluate(tab, 'JSON.stringify({title: document.title, url: location.href, text: document.body?.innerText || \'\'})')
  const page = JSON.parse(String(value)) as { title: string; url: string; text: string }
  return { content: [{ type: 'text', text: JSON.stringify({ ...page, text: page.text.slice(0, maxChars) }, null, 2) }] }
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
  description: 'Inspección rápida estructurada y de solo lectura de la pestaña real: campos, etiquetas, tipos, opciones, protegido/deshabilitado/readonly, formularios y frames. Una llamada antes de completar un formulario; no requiere escritorio ni captura de pantalla. No incluye contraseñas, cookies ni contenido de campos sensibles.',
  inputSchema: { tabId: z.string().optional() },
}, async ({ tabId }) => {
  const tab = await selectedTab(tabId)
  return formatBrowserResult(await evaluate(tab, browserInteractionExpression({ operation: 'inspect' })))
})

server.registerTool('fill_form', {
  description: 'Completa en UNA llamada hasta 30 campos de una pestaña Chromium (textos, contraseña ficticia, fecha, textarea, select, checkbox y radio). Busca por selector CSS, nombre, label o placeholder. Rechaza controles de solo lectura, deshabilitados, ocultos, ambiguos o archivos. Emite eventos input/change y verifica cada valor sin devolver contraseñas. No envía formulario. Respeta permisos; no necesita Computer visible.',
  inputSchema: { tabId: z.string().optional(), fields: z.array(fieldAction).min(1).max(30) },
}, async ({ tabId, fields }) => {
  ensureBrowserActionPermission()
  const tab = await selectedTab(tabId)
  return formatBrowserResult(await evaluate(tab, browserBatchExpression(fields as BrowserInteraction[])))
})

server.registerTool('interact', {
  description: 'Control estructurado de elementos visibles en Chromium: clic, selección, desplazamiento, marcado o escritura, sin JavaScript arbitrario, con comprobación de existencia y ambigüedad. Si hay CAPTCHA, login externo, popup nativo o iframe de otro origen, informa el bloqueo y pide intervención humana.',
  inputSchema: { tabId: z.string().optional(), ...targetSchema,
    operation: z.enum(['fill', 'select', 'check', 'click', 'scroll']),
    value: z.string().max(4096).optional(), checked: z.boolean().optional() },
}, async ({ tabId, ...input }) => {
  ensureBrowserActionPermission()
  return formatBrowserResult(await evaluate(await selectedTab(tabId), browserInteractionExpression(input as BrowserInteraction)))
})

server.registerTool('submit_form', {
  description: 'Envía el formulario de una pestaña SOLO si la petición del usuario autorizó explícitamente el envío. Debe inspeccionarse/completarse primero; usa selector=form o un control submit concreto. Devuelve comprobante de intento, no inventa éxito: después usa wait_for para comprobar texto y URL finales. No usar para compras, borrados, envíos de dinero ni acciones sensibles sin confirmación del usuario.',
  inputSchema: { tabId: z.string().optional(), ...targetSchema,
    confirmation: z.literal(true) },
}, async ({ tabId, confirmation, ...target }) => {
  ensureBrowserActionPermission()
  if (!confirmation) throw new Error('Se requiere confirmación del usuario para enviar el formulario.')
  const tab = await selectedTab(tabId)
  return formatBrowserResult(await evaluate(tab, browserInteractionExpression({ ...target, operation: 'submit' })))
})

server.registerTool('wait_for', {
  description: 'Espera hasta 8 segundos el texto visible de confirmación tras navegar o enviar un formulario. Consulta el DOM real con pocas comprobaciones; no repite el envío. Informa texto encontrado o timeout y URL final verificada.',
  inputSchema: { tabId: z.string().optional(), expectedText: z.string().min(1).max(250), timeoutMs: z.number().int().min(200).max(8000).default(5000) },
}, async ({ tabId, expectedText, timeoutMs }) => {
  const tab = await selectedTab(tabId)
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

server.registerTool('screenshot', {
  description: 'Vista visual REAL de Chromium (JPEG 1280x720) únicamente cuando la inspección DOM no sea suficiente. Permite reconocer canvas, menús, diseños, errores y diálogos web. Puede costar más tokens que inspect_page; evita capturas repetidas.',
  inputSchema: { tabId: z.string().optional() },
}, async ({ tabId }) => {
  const tab = await selectedTab(tabId)
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
  inputSchema: { tabId: z.string().optional(), action: z.enum(['click','scroll']),
    x: z.number().min(0).max(1280), y: z.number().min(0).max(720),
    deltaY: z.number().min(-1500).max(1500).optional() },
}, async ({ tabId, action, x, y, deltaY }) => {
  ensureBrowserActionPermission()
  const tab = await selectedTab(tabId)
  if (action === 'scroll') {
    await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: deltaY ?? 480 })
  } else {
    await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  return { content: [{ type: 'text', text: 'Acción enviada al Chromium real, pestaña ' + tab.id
    + '. Verifica con inspect_page o screenshot antes de afirmar el resultado.' }] }
})

server.registerTool('press_key', {
  description: 'Tecla de navegador (Enter, Tab, Escape, Backspace, flechas, letras, dígitos y modificadores). Alternativa CDP a Computer si la ventana de escritorio está oculta. Nunca escribe en otra aplicación del sistema.',
  inputSchema: { tabId: z.string().optional(), key: z.string().min(1).max(25),
    modifiers: z.number().int().min(0).max(15).default(0) },
}, async ({ tabId, key, modifiers }) => {
  ensureBrowserActionPermission()
  const allowed = new Set(['Enter','Tab','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'])
  if (!allowed.has(key) && !/^[a-zA-Z0-9 ]$/.test(key)) throw new Error('Tecla no admitida; solo navegación y texto simple.')
  const tab = await selectedTab(tabId)
  const virtualCodes: Record<string, number> = {
    Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
    Home: 36, End: 35, PageUp: 33, PageDown: 34,
  }
  const virtual = virtualCodes[key] ?? key.toUpperCase().charCodeAt(0)
  const params = { key, code: key, modifiers, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual }
  await cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyDown', ...params,
    ...(key.length === 1 && modifiers === 0 ? { text: key } : key === 'Enter' ? { text: '\r' } : {}) })
  await cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  return { content: [{ type: 'text', text: 'Tecla enviada: ' + key + ' en la pestaña ' + tab.id }] }
})

server.registerTool('type_text', {
  description: 'Escribe texto en el campo actualmente enfocado del Chromium del chat mediante CDP, sin ventana visible. Inspecciona y enfoca antes: no escribir a ciegas. Para formularios normales usar fill_form es más rápido y fiable.',
  inputSchema: { tabId: z.string().optional(), text: z.string().max(4096) },
}, async ({ tabId, text }) => {
  ensureBrowserActionPermission()
  const tab = await selectedTab(tabId)
  const focused = await evaluate(tab, 'Boolean(document.activeElement && (document.activeElement.matches("input:not([type=hidden]):not([disabled]):not([readonly]),textarea:not([disabled]):not([readonly]),[contenteditable=true]")))')
  if (focused !== true) throw new Error('No hay campo editable enfocado en Chromium. Usa inspect_page e interact primero.')
  await cdp(tab, 'Input.insertText', { text })
  return { content: [{ type: 'text', text: 'Texto introducido en el control enfocado. Verifica en el DOM antes de confirmar.' }] }
})

server.registerTool('click_text', {
  description: 'Hace clic en un elemento cuyo texto coincide cuando la política de permisos del navegador permite acciones.',
  inputSchema: { text: z.string().min(1), tabId: z.string().optional() },
}, async ({ text, tabId }) => {
  if (!actionsAllowed()) throw new Error('Acción bloqueada por la política de permisos del navegador (modo read-only o PHOENIX_BROWSER_ALLOW_ACTIONS=false).')
  const tab = await selectedTab(tabId)
  const escaped = JSON.stringify(text)
  const result = await evaluate(tab, `(() => { const wanted=${escaped}; const el=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"]')].find(e => (e.innerText || e.value || '').trim().includes(wanted)); if (!el) return 'No encontrado'; if (el.type === 'submit') return 'Usa submit_form con confirmación explícita'; el.click(); return 'Clic realizado'; })()`)
  return { content: [{ type: 'text', text: String(result) }] }
})

/** Start the local stdio MCP connector. */
export async function startChromeConnector(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
