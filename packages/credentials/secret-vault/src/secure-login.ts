/**
 * User-only secure website logins. Values travel from the in-chat protected form
 * directly to this loopback broker, never through agent messages or MCP arguments.
 * Windows DPAPI CurrentUser protects each origin-bound record at rest.
 */
import type { Context } from '@phoenix-ai/cordis'
import type {} from '@phoenix-ai/dsh-host-webserver'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface LoginRecord { version: 1; origin: string; automatic: boolean; sealed: string }
interface LoginContent { origin: string; account: string; secret: string }
interface BrowserTab { id: string; type?: string; url: string; webSocketDebuggerUrl?: string }
const PREFIX = '/phoenix-secure-login'
const STORE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'secure-logins')
const SHARED_BROWSER = join(tmpdir(), 'phoenix-browser-cdp.json')
const SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$body = [Convert]::FromBase64String($payload.body)',
  '$entropy = [Convert]::FromBase64String($payload.entropy)',
  '$scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser',
  'if ($payload.mode -eq "protect") { $result = [System.Security.Cryptography.ProtectedData]::Protect($body, $entropy, $scope) }',
  'elseif ($payload.mode -eq "unprotect") { $result = [System.Security.Cryptography.ProtectedData]::Unprotect($body, $entropy, $scope) }',
  'else { throw "Invalid operation" }',
  '[Console]::Out.Write([Convert]::ToBase64String($result))',
].join('\n')

/** Only complete secure web origins are accepted, with loopback HTTP for development. */
export function loginOrigin(raw: string): string {
  const parsed = new URL(raw)
  if (parsed.username || parsed.password || parsed.origin === 'null') throw new Error('Origen no válido')
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]'
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) throw new Error('Solo HTTPS')
  return parsed.origin
}
function filename(origin: string): string {
  return join(STORE, createHash('sha256').update(origin).digest('hex') + '.dpapi.json')
}
function entropy(origin: string): string {
  return createHash('sha256').update('phoenix-login-v1:' + origin).digest('base64')
}

/** Secret data only on child stdin, never in process arguments, stdout errors or logs. */
async function dpapi(mode: 'protect' | 'unprotect', body: string, origin: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Bóveda de Windows no disponible')
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(SCRIPT, 'utf16le').toString('base64'),
    ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
    let result = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result.trim())
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('La bóveda no respondió'))
    }, 12_000)
    child.on('error', () => finish(new Error('La bóveda no está disponible')))
    child.stdout.on('data', (chunk: Buffer) => {
      result += chunk.toString('utf8')
      if (result.length > 65_536) {
        child.kill()
        finish(new Error('Respuesta de la bóveda demasiado grande'))
      }
    })
    child.on('close', code => {
      if (code !== 0 || !result.trim()) finish(new Error('Operación segura rechazada'))
      else finish()
    })
    child.stdin.on('error', () => { /* Process close reports a sanitized failure. */ })
    child.stdin.end(JSON.stringify({ mode, body, entropy: entropy(origin) }))
  })
}
async function load(origin: string): Promise<LoginRecord | undefined> {
  try {
    const row = JSON.parse(await readFile(filename(origin), 'utf8')) as LoginRecord
    return row.version === 1 && row.origin === origin && typeof row.sealed === 'string'
      && typeof row.automatic === 'boolean' ? row : undefined
  } catch { return undefined }
}
async function store(origin: string, account: string, secret: string, automatic: boolean): Promise<void> {
  const body = Buffer.from(JSON.stringify({ origin, account, secret } satisfies LoginContent), 'utf8').toString('base64')
  const sealed = await dpapi('protect', body, origin)
  const row: LoginRecord = { version: 1, origin, automatic, sealed }
  await mkdir(STORE, { recursive: true, mode: 0o700 })
  const temporary = filename(origin) + '.' + randomUUID() + '.tmp'
  try {
    await writeFile(temporary, JSON.stringify(row), { mode: 0o600, flag: 'wx' })
    await rename(temporary, filename(origin))
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
function loopbackRequest(req: IncomingMessage): boolean {
  const remote = req.socket.remoteAddress ?? ''
  const host = req.headers.host ?? ''
  const hostname = (() => { try { return new URL('http://' + host).hostname } catch { return '' } })()
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
    && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
    && req.headers['x-phoenix-secure-login'] === '1'
    && req.headers['sec-fetch-site'] !== 'cross-site'
    && (req.method !== 'POST' || req.headers.origin === 'http://' + host)
}
async function input(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += part.length
    if (size > 32_768) throw new Error('Formulario demasiado grande')
    chunks.push(part)
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('Formulario inválido')
  return body as Record<string, unknown>
}
function respond(res: ServerResponse, code: number, body: Record<string, unknown>): void {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}
async function tabForLogin(tabId: string, origin: string): Promise<BrowserTab> {
  const shared = JSON.parse(await readFile(SHARED_BROWSER, 'utf8')) as { endpoint?: string }
  if (!shared.endpoint) throw new Error('Chrome no está disponible')
  const base = new URL(shared.endpoint)
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
    || base.username || base.password) throw new Error('Conexión de Chrome inválida')
  const response = await fetch(new URL('/json/list', base), { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error('Chrome no responde')
  const rows = await response.json() as BrowserTab[]
  const tab = rows.find(row => row.id === tabId && row.type === 'page')
  if (!tab?.webSocketDebuggerUrl || loginOrigin(tab.url) !== origin) {
    throw new Error('La pestaña no coincide con el sitio autorizado')
  }
  const socket = new URL(tab.webSocketDebuggerUrl)
  if (!['ws:'].includes(socket.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(socket.hostname)) {
    throw new Error('Conexión CDP no permitida')
  }
  return tab
}

/** Only a sanitized result crosses back to the UI. Credentials never enter a tool result. */
async function injectLogin(tab: BrowserTab, login: LoginContent): Promise<string> {
  const expression = '(async () => {'
    + 'const expected=' + JSON.stringify(login.origin) + ';'
    + 'if(location.origin!==expected) return "origin-changed";'
    + 'const fields=[...document.querySelectorAll("input")].filter(e=>!e.disabled && !e.readOnly && e.getClientRects().length);'
    + 'const passwords=fields.filter(e=>e.type==="password");'
    + 'if(passwords.length!==1) return "login-form-not-found";'
    + 'const pass=passwords[0];'
    + 'const account=fields.find(e=>e.autocomplete==="username") || fields.find(e=>e.type==="email")'
    + ' || fields.find(e=>/user|email|login|account/i.test((e.name||"")+" "+(e.id||"")))'
    + ' || fields.find(e=>e!==pass && (e.type==="text" || e.type==="email"));'
    + 'if(!account) return "login-form-not-found";'
    + 'const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;'
    + 'const set=(el,v)=>{setter.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));};'
    + 'set(account,' + JSON.stringify(login.account) + ');'
    + 'set(pass,' + JSON.stringify(login.secret) + ');'
    + 'await new Promise(resolve=>setTimeout(resolve,80));'
    + 'if(location.origin!==expected) return "origin-changed";'
    + 'const form=pass.form || account.form; if(!form) return "login-form-not-found";'
    + 'const button=form.querySelector("button[type=submit],input[type=submit]");'
    + 'if(button) button.click(); else form.requestSubmit();'
    + 'return "submitted";'
    + '})()'
  return await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(tab.webSocketDebuggerUrl as string)
    let completed = false
    const finish = (error?: Error, status?: string): void => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      ws.close()
      if (error) reject(error)
      else resolve(status ?? 'failed')
    }
    const timer = setTimeout(() => finish(new Error('Chrome no respondió')), 12_000)
    ws.addEventListener('error', () => finish(new Error('Conexión segura con Chrome fallida')))
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1, method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }))
    })
    ws.addEventListener('message', event => {
      try {
        const data = JSON.parse(String(event.data)) as {
          id?: number; error?: unknown; result?: { exceptionDetails?: unknown; result?: { value?: unknown } }
        }
        if (data.id !== 1) return
        if (data.error || data.result?.exceptionDetails) return finish(new Error('El formulario rechazó el inicio de sesión'))
        finish(undefined, String(data.result?.result?.value ?? 'failed'))
      } catch { finish(new Error('Respuesta inválida de Chrome')) }
    })
  })
}
async function useLogin(origin: string, tabId: string, manual: boolean): Promise<string> {
  const saved = await load(origin)
  if (!saved || (!saved.automatic && !manual)) return 'not-authorized'
  const tab = await tabForLogin(tabId, origin)
  const plain = await dpapi('unprotect', saved.sealed, origin)
  const login = JSON.parse(Buffer.from(plain, 'base64').toString('utf8')) as LoginContent
  if (login.origin !== origin || !login.account || !login.secret) throw new Error('Registro de bóveda inválido')
  return await injectLogin(tab, login)
}

/** Route lives on the host, outside every model-facing MCP tool and session log. */
export function registerSecureLogin(ctx: Context): () => void {
  return ctx.webServer.register({
    kind: 'prefix',
    path: PREFIX,
    handler: async (req, res) => {
      if (!loopbackRequest(req)) { respond(res, 403, { error: 'Acceso local no autorizado' }); return }
      try {
        const route = new URL(req.url ?? '/', 'http://localhost')
        if (req.method === 'GET' && route.pathname === PREFIX + '/status') {
          const origin = loginOrigin(route.searchParams.get('origin') ?? '')
          const record = await load(origin)
          respond(res, 200, { saved: Boolean(record), automatic: record?.automatic ?? false })
          return
        }
        if (req.method !== 'POST') { respond(res, 405, { error: 'Operación no permitida' }); return }
        const payload = await input(req)
        const origin = loginOrigin(String(payload.origin ?? ''))
        if (route.pathname === PREFIX + '/save') {
          const account = payload.account
          const secret = payload.secret
          if (typeof account !== 'string' || !account.trim() || account.length > 4096
            || typeof secret !== 'string' || !secret || secret.length > 16384) {
            throw new Error('Credenciales incompletas')
          }
          await store(origin, account, secret, payload.automatic === true)
          respond(res, 200, { saved: true, automatic: payload.automatic === true })
          return
        }
        if (route.pathname === PREFIX + '/delete') {
          await rm(filename(origin), { force: true })
          respond(res, 200, { saved: false, automatic: false })
          return
        }
        if (route.pathname === PREFIX + '/use') {
          if (typeof payload.tabId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(payload.tabId)) {
            throw new Error('Pestaña no válida')
          }
          const status = await useLogin(origin, payload.tabId, payload.manual === true)
          respond(res, 200, { status })
          return
        }
        respond(res, 404, { error: 'Ruta desconocida' })
      } catch {
        // NEVER reflect secrets, CDP expressions, PowerShell errors or original payloads.
        respond(res, 400, { error: 'No se pudo completar la operación segura; verifica el sitio y la bóveda.' })
      }
    },
  })
}
