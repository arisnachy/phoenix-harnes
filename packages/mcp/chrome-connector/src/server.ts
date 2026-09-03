/**
 * Local Chromium-browser MCP connector (Chrome or Microsoft Edge).
 *
 * It attaches only to loopback CDP endpoints. When no user-provided endpoint
 * exists, PHOENIX can start a dedicated Chromium instance with an isolated
 * temporary profile; personal Chrome/Edge profile files are never opened.
 * Mutating actions require explicit PHOENIX_BROWSER_ALLOW_ACTIONS=true.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const DEFAULT_PORTS = [9222, 9223, 9224]
const CDP_READY_TIMEOUT_MS = 12_000
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

/** Build Chrome/Edge flags for PHOENIX's isolated CDP browser. */
export function buildDedicatedBrowserArgs(profileDir: string, headless = false): string[] {
  return [
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
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
    for (const root of roots) {
      candidates.push(
        join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      )
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
type CdpResponse = { id: number; result?: { result?: { value?: unknown; description?: string } }; error?: { message: string } }

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
  if (!response.ok) throw new Error(`El navegador respondió HTTP ${response.status}`)
  return await response.json() as T
}

function cleanupManagedBrowser(): void {
  try { managedBrowser?.kill() } catch { /* best effort */ }
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
    const headless = process.env.PHOENIX_BROWSER_HEADLESS === 'true'
      || process.env.DSH_CHROME_HEADLESS === 'true'
    const child = spawn(executable, buildDedicatedBrowserArgs(profileDir, headless), {
      stdio: 'ignore',
      windowsHide: false,
    })
    managedBrowser = child
    managedProfileDir = profileDir
    let spawnError: Error | undefined
    child.once('error', error => { spawnError = error })
    if (!cleanupRegistered) {
      cleanupRegistered = true
      process.once('exit', cleanupManagedBrowser)
    }
    try {
      const base = await waitForManagedEndpoint(profileDir)
      managedEndpoint = base
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
  const configured = cdpBase()
  if (configured) {
    await json(`${configured}/json/version`)
    return configured
  }
  for (const port of DEFAULT_PORTS) {
    const candidate = `http://127.0.0.1:${port}`
    try { await json(`${candidate}/json/version`); return candidate } catch { /* try next port */ }
  }
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

async function selectedTab(id?: string): Promise<Tab> {
  const available = await tabs()
  const tab = id ? available.find(candidate => candidate.id === id) : available[0]
  if (!tab) throw new Error(id ? `No existe la pestaña ${id}` : 'El navegador no tiene pestañas web disponibles')
  if (!tab.webSocketDebuggerUrl) throw new Error('La pestaña no ofrece una conexión CDP')
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
    socket.addEventListener('open', () => { socket.send(JSON.stringify({ id, method, params })) })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as CdpResponse
      if (message.id !== id) return
      clearTimeout(timer); socket.close()
      if (message.error) reject(new Error(message.error.message))
      else resolve((message.result?.result?.value ?? message.result) as T)
    })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`No se pudo conectar con ${tab.url}`)) })
  })
}

async function evaluate(tab: Tab, expression: string): Promise<unknown> {
  return await cdp(tab, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
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
  if (!actionsAllowed()) throw new Error('Navegación bloqueada: habilita PHOENIX_BROWSER_ALLOW_ACTIONS solo después de aprobarlo explícitamente.')
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Solo se permiten URLs HTTP(S)')
  const tab = await selectedTab(tabId)
  await cdp(tab, 'Page.navigate', { url })
  return { content: [{ type: 'text', text: `Navegación iniciada en ${url} (pestaña ${tab.id})` }] }
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

server.registerTool('click_text', {
  description: 'Hace clic en un elemento cuyo texto coincide. Requiere PHOENIX_BROWSER_ALLOW_ACTIONS=true.',
  inputSchema: { text: z.string().min(1), tabId: z.string().optional() },
}, async ({ text, tabId }) => {
  if (!actionsAllowed()) throw new Error('Acción bloqueada: habilita PHOENIX_BROWSER_ALLOW_ACTIONS solo después de aprobarlo explícitamente.')
  const tab = await selectedTab(tabId)
  const escaped = JSON.stringify(text)
  const result = await evaluate(tab, `(() => { const wanted=${escaped}; const el=[...document.querySelectorAll('button,a,[role="button"],input[type="submit"]')].find(e => (e.innerText || e.value || '').trim().includes(wanted)); if (!el) return 'No encontrado'; el.click(); return 'Clic realizado'; })()`)
  return { content: [{ type: 'text', text: String(result) }] }
})

/** Start the local stdio MCP connector. */
export async function startChromeConnector(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
