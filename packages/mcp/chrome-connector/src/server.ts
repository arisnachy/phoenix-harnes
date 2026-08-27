/**
 * Local Chromium-browser MCP connector (Chrome or Microsoft Edge).
 *
 * It talks only to a browser instance that the user explicitly launched with
 * the DevTools Protocol enabled. It never reads Chrome profile files or
 * credentials. Mutating actions require explicit PHOENIX_BROWSER_ALLOW_ACTIONS=true.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const DEFAULT_PORTS = [9222, 9223, 9224]
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

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
}

type Tab = { id: string; title: string; url: string; webSocketDebuggerUrl?: string; type?: string }
type CdpResponse = { id: number; result?: { result?: { value?: unknown; description?: string } }; error?: { message: string } }

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
  if (!response.ok) throw new Error(`El navegador respondió HTTP ${response.status}`)
  return await response.json() as T
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
  throw new Error('Chrome/Edge no está expuesto por CDP. Inícialo con --remote-debugging-port=9222 o configura PHOENIX_BROWSER_CDP_URL.')
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
    socket.addEventListener('open', () =>{  socket.send(JSON.stringify({ id, method, params })) })
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
  { name: 'phoenix-browser-connector', version: '0.2.0' },
  { capabilities: { tools: {} } },
)

server.registerTool('status', {
  description: 'Comprueba si existe una sesión Chrome o Edge CDP explícitamente habilitada.',
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
