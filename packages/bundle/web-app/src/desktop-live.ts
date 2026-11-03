/** Session-scoped native application frames, surfaced in the Phoenix Web chat. */
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@phoenix-ai/cordis'
import type {} from '@phoenix-ai/dsh-host-webserver'
import { miniBrowserRequestAllowed, miniBrowserSingleHeader } from './mini-browser.ts'
import { validBrowserScopeId } from './mini-browser-scopes.ts'

interface NativeState { available: boolean; paused: boolean; title: string; reason: string; source?: 'native' | 'observation' }
const DISCONNECTED: NativeState = {
  available: false, paused: false, title: '', reason: 'Aún no hay una captura verificada de esta conversación. En Phoenix web, computer debe capturar Paint primero; para vídeo continuo se requiere Phoenix.exe.',
}
const TIMEOUT_MS = 3_000
const MAX_REPLY_BYTES = 24 * 1024 * 1024

function authorized(req: IncomingMessage): boolean {
  return miniBrowserRequestAllowed({
    remoteAddress: req.socket.remoteAddress,
    host: req.headers.host,
    origin: req.headers.origin,
    marker: miniBrowserSingleHeader(req.headers['x-phoenix-mini-browser']),
    fetchSite: req.headers['sec-fetch-site'],
  })
}

function sendJson(res: ServerResponse, status: number, object: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(object))
}

function requestedSession(req: IncomingMessage): string {
  const id = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('sessionId')
  if (!validBrowserScopeId(id) || id.length > 128 || id.includes('.')) throw new Error('Identificador de conversación inválido.')
  return id
}

function descriptorPath(): string | null {
  if (process.platform !== 'win32') return null
  const explicit = process.env.PHOENIX_DESKTOP_CONTROL_DESCRIPTOR?.trim()
  if (explicit) return explicit
  const appData = process.env.LOCALAPPDATA?.trim()
  return appData ? join(appData, 'Phoenix', 'desktop-control.json') : null
}

/** Parse only the known user-owned pipe descriptor, not caller-supplied names.
 * @param raw - Raw descriptor JSON from the current-user installation.
 * @returns The validated local pipe name.
 */
export function desktopLivePipeName(raw: string): string {
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Descriptor Desktop Live inválido.')
  }
  const data = parsed as { schema?: unknown; pipeName?: unknown }
  if (data.schema !== 1 || typeof data.pipeName !== 'string'
    || !/^PhoenixDesktop\.Browser\.[A-Za-z0-9._-]{1,96}$/u.test(data.pipeName)) {
    throw new Error('Desktop Live requiere el canal local nativo compatible.')
  }
  return data.pipeName
}

function queryPipe(pipe: string, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection('\\\\.\\pipe\\' + pipe)
    let settled = false
    let received = ''
    socket.setEncoding('utf8')
    const finish = (error?: Error, response?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      socket.destroy()
      if (error !== undefined) reject(error)
      else resolve(response ?? '')
    }
    const deadline = setTimeout(() => finish(new Error('Tiempo agotado consultando Desktop Live.')), TIMEOUT_MS)
    socket.once('connect', () => socket.write(message + '\n'))
    socket.on('data', (part: string) => {
      received += part
      if (received.length > MAX_REPLY_BYTES) {
        finish(new Error('Captura Desktop Live demasiado grande.'))
        return
      }
      const end = received.indexOf('\n')
      if (end >= 0) finish(undefined, received.slice(0, end).trim())
    })
    socket.once('error', (error: Error) => finish(error))
    socket.once('close', () => { if (!settled) finish(new Error('Canal Desktop Live cerrado.')) })
  })
}

async function requestNative(sessionId: string, type: string): Promise<string> {
  const path = descriptorPath()
  if (path === null) throw new Error(DISCONNECTED.reason)
  const pipe = desktopLivePipeName(await readFile(path, 'utf8'))
  const raw = await queryPipe(pipe, JSON.stringify({ type, sessionId }))
  const value: unknown = JSON.parse(raw)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Respuesta nativa Desktop Live inválida.')
  }
  const reply = value as { ok?: unknown; details?: unknown; error?: unknown }
  if (reply.ok !== true) throw new Error(typeof reply.error === 'string' ? reply.error : 'Desktop Live no disponible.')
  if (typeof reply.details !== 'string') throw new Error('Faltan datos de Desktop Live.')
  return reply.details
}

const OBSERVATION_MAX_AGE_MS = 90_000

function observationFile(sessionId: string): string {
  return join(tmpdir(), 'phoenix-desktop-observations',
    createHash('sha256').update(sessionId).digest('hex') + '.png')
}

async function recentObservation(sessionId: string): Promise<Buffer | undefined> {
  const path = observationFile(sessionId)
  try {
    const file = await stat(path)
    if (Date.now() - file.mtimeMs > OBSERVATION_MAX_AGE_MS
      || file.size < 24 || file.size > 16 * 1024 * 1024) return undefined
    const png = await readFile(path)
    return png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? png : undefined
  } catch {
    return undefined
  }
}

/** A dead host is not a live application; never synthesize a success state.
 * @param sessionId - Exact owning Phoenix conversation identifier.
 * @returns The live native or verified recent observation status.
 */
export async function readDesktopLiveState(sessionId: string): Promise<NativeState> {
  try {
    const raw = await requestNative(sessionId, 'phoenix.desktop.live-state')
    const data: unknown = JSON.parse(raw)
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('Estado incorrecto.')
    const state = data as Partial<NativeState>
    if (typeof state.available !== 'boolean' || typeof state.paused !== 'boolean'
      || typeof state.title !== 'string' || typeof state.reason !== 'string') {
      throw new Error('Estado Desktop Live incompleto.')
    }
    if (state.available) return { available: true, paused: state.paused, title: state.title, reason: state.reason, source: 'native' }
  } catch {
    // A missing native shell may still have real screenshots from the model tool.
  }
  const observation = await recentObservation(sessionId)
  return observation === undefined ? DISCONNECTED : {
    available: true, paused: false, title: 'Última captura verificada del escritorio',
    reason: 'Captura posterior a una acción de Computer Use; no es vídeo en directo.', source: 'observation',
  }
}

/** Retrieve an existing, session-owned PNG, never a fabricated application frame.
 * @param sessionId - Exact owning conversation identifier.
 * @returns Verified native or recently observed PNG bytes.
 */
export async function readDesktopLiveFrame(sessionId: string): Promise<Buffer> {
  let base64: string
  try {
    base64 = await requestNative(sessionId, 'phoenix.desktop.live-frame')
  } catch (error) {
    // A native owner is never disguised as a fresh frame from the last tool action.
    // The screenshot fallback is valid only if the native viewer is unavailable.
    const state = await readDesktopLiveState(sessionId)
    if (state.source === 'native') throw error
    const observed = await recentObservation(sessionId)
    if (observed === undefined) throw new Error('No existe una captura Desktop Live verificable para esta conversación.')
    return observed
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(base64)) throw new Error('Imagen Desktop Live inválida.')
  const png = Buffer.from(base64, 'base64')
  if (png.byteLength < 24 || png.byteLength > 16 * 1024 * 1024
    || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('No se recibió una captura PNG auténtica.')
  }
  return png
}

/** Attach the visible native app to the conversation without another browser.
 * @param ctx - Web host with a server route registry.
 */
export function registerDesktopLiveRoutes(ctx: Context): void {
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    if (!authorized(req)) { sendJson(res, 403, { error: 'Origen no autorizado.' }); return false }
    if (req.method !== 'GET') { sendJson(res, 405, { error: 'Método no permitido.' }); return false }
    return true
  }
  const disposeState = ctx.webServer.register({
    kind: 'exact', path: '/phoenix-desktop-live/state',
    handler: async (req, res) => {
      if (!guard(req, res)) return
      try { sendJson(res, 200, await readDesktopLiveState(requestedSession(req))) }
      catch (error) { sendJson(res, 400, { error: String(error) }) }
    },
  })
  const disposeFrame = ctx.webServer.register({
    kind: 'exact', path: '/phoenix-desktop-live/frame',
    handler: async (req, res) => {
      if (!guard(req, res)) return
      try {
        const png = await readDesktopLiveFrame(requestedSession(req))
        res.writeHead(200, {
          'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        })
        res.end(png)
      } catch (error) {
        if (!res.writableEnded) sendJson(res, 503, { error: String(error) })
      }
    },
  })
  ctx.effect(() => () => { disposeFrame(); disposeState() }, 'web-app: native desktop live routes')
}
