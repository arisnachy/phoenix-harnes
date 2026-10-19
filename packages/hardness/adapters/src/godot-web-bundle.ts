/**
 * Godot Web bundle host. Godot is the *only* runtime for authored Godot games:
 * serve the original exported HTML/JS/WASM/PCK under an unguessable scoped path.
 * Opaque-origin iframe sandbox is enforced by the client (no allow-same-origin).
 * This is a structural gate, NOT evidence that a user actually played the game.
 */
import { randomBytes } from 'node:crypto'
import {
  closeSync, copyFileSync, createReadStream, mkdirSync, openSync, readFileSync, readSync,
  readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const PHOENIX_GODOT_WEB_MIME = 'application/vnd.phoenix.game+godot-web'
const ROUTE = '/phoenix-games/godot'
const ROOT = join(homedir(), '.dsh', 'game-studio-web')
const TOKEN = /^[a-f0-9]{48}$/u
const FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/u
const EXTENSIONS = new Set(['.html', '.js', '.wasm', '.pck', '.png', '.ico', '.svg', '.css',
  '.json', '.webmanifest', '.ogg', '.mp3', '.wav', '.webp', '.woff', '.woff2', '.ttf'])
const MAX_FILES = 40
const MAX_BYTES = 512 * 1024 * 1024
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm', '.pck': 'application/octet-stream',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}
export interface GodotBundleReceipt {
  readonly url: string
  readonly title: string
  readonly engine: 'godot'
  readonly structureChecked: true
  readonly browserPlaybackVerified: false
  readonly fileCount: number
  readonly bytes: number
}
type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
export interface GameWebRouteHost {
  register(route: { readonly kind: 'prefix'; readonly path: string; readonly handler: HttpHandler }): () => void
}
function safelyInside(root: string, entry: string): string {
  const value = realpathSync(resolve(root, entry))
  const child = relative(root, value)
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) {
    throw new Error('Export must be located inside the Phoenix task workspace.')
  }
  return value
}
function exactFile(dir: string, name: string): string {
  if (!FILE.test(name) || !EXTENSIONS.has(extname(name).toLowerCase())) throw new Error('Unsupported Godot asset filename.')
  const target = realpathSync(join(dir, name))
  if (dirname(target) !== dir || !statSync(target).isFile()) throw new Error('Godot export contains a file escaping its directory.')
  return target
}
function magic(file: string): Buffer {
  const header = Buffer.alloc(4)
  const handle = openSync(file, 'r')
  try {
    if (readSync(handle, header, 0, 4, 0) !== 4) throw new Error('Truncated Godot binary.')
  } finally {
    closeSync(handle)
  }
  return header
}
function validateExport(exportDir: string): { files: Array<{ name: string; source: string; bytes: number }>; bytes: number } {
  const names = readdirSync(exportDir)
  if (names.length < 4 || names.length > MAX_FILES) throw new Error('Godot export must contain 4–40 flat resource files.')
  for (const name of ['index.html', 'index.js', 'index.wasm', 'index.pck']) {
    if (!names.includes(name)) throw new Error('Missing Godot Web export file: ' + name)
  }
  const files = names.map(name => {
    const source = exactFile(exportDir, name)
    const bytes = statSync(source).size
    if (bytes <= 0) throw new Error('Empty Godot Web asset: ' + name)
    return { name, source, bytes }
  })
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0)
  if (bytes > MAX_BYTES) throw new Error('Godot Web export exceeds 512 MiB.')
  const html = readFileSync(join(exportDir, 'index.html'), 'utf8')
  if (!html.includes('index.js') || !/\b(?:GODOT_CONFIG|new\s+Engine)\b/u.test(html)) {
    throw new Error('index.html is not a matching Godot Web shell.')
  }
  const js = readFileSync(join(exportDir, 'index.js'), 'utf8')
  if (!/\bEngine\b/u.test(js)) throw new Error('Godot engine loader is missing.')
  if (!magic(join(exportDir, 'index.wasm')).equals(Buffer.from([0, 97, 115, 109]))) {
    throw new Error('Invalid Godot WebAssembly header.')
  }
  if (!magic(join(exportDir, 'index.pck')).equals(Buffer.from('GDPC'))) {
    throw new Error('Invalid Godot PCK header.')
  }
  return { files, bytes }
}
/** Package an export inside the Phoenix host cache, not under arbitrary URL paths. */
export function publishGodotWebExport(exportPath: string, workspace: string, title: string): GodotBundleReceipt {
  if (!routeIsMounted) throw new Error('Godot Web publisher is unavailable: the Phoenix web host route is not mounted.')
  if (!workspace?.trim() || !exportPath?.trim() || !title?.trim()) throw new Error('Workspace, Godot export path and game title are required.')
  const cwd = realpathSync(workspace)
  const exportDir = safelyInside(cwd, exportPath)
  if (!statSync(exportDir).isDirectory()) throw new Error('Godot Web export path is not a directory.')
  const plan = validateExport(exportDir)
  mkdirSync(ROOT, { recursive: true, mode: 0o700 })
  const token = randomBytes(24).toString('hex')
  const folder = join(ROOT, token)
  mkdirSync(folder, { mode: 0o700 })
  try {
    for (const file of plan.files) copyFileSync(file.source, join(folder, file.name))
    writeFileSync(join(folder, 'manifest.json.phoenix'), JSON.stringify({ title, entry: 'index.html', bytes: plan.bytes }), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    rmSync(folder, { recursive: true, force: true })
    throw error
  }
  return {
    url: ROUTE + '/' + token + '/index.html', title, engine: 'godot',
    structureChecked: true, browserPlaybackVerified: false,
    fileCount: plan.files.length, bytes: plan.bytes,
  }
}
let routeIsMounted = false
/** Registration should occur exactly once in the host scope, not per agent. */
export function mountGodotWebRoute(server: GameWebRouteHost): () => void {
  if (routeIsMounted) return () => {}
  const dispose = server.register({ kind: 'prefix', path: ROUTE, handler: serveGodotWebFile })
  routeIsMounted = true
  return () => { routeIsMounted = false; dispose() }
}
export function serveGodotWebFile(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const parts = url.pathname.split('/')
  const base = ROUTE.split('/').filter(Boolean)
  const relativeParts = parts.filter(Boolean)
  const token = relativeParts[base.length]
  const name = relativeParts[base.length + 1]
  if (relativeParts.slice(0, base.length).join('/') !== base.join('/') ||
    relativeParts.length !== base.length + 2 || token === undefined || !TOKEN.test(token)
    || name === undefined || !FILE.test(name) || !EXTENSIONS.has(extname(name).toLowerCase())) {
    res.writeHead(404).end()
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
  const root = join(ROOT, token)
  let target: string
  try {
    target = exactFile(realpathSync(root), name)
  } catch {
    res.writeHead(404).end()
    return
  }
  // Use an opaque-origin sandbox. Never grant allow-same-origin in the client:
  // that would give user-provided game scripts Phoenix's session origin.
  const authority = typeof req.headers.host === 'string' && /^[a-zA-Z0-9.:[\]-]+(?::\d+)?$/u.test(req.headers.host)
    ? req.headers.host : '127.0.0.1'
  const secure = Boolean((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted)
  const origin = (secure ? 'https://' : 'http://') + authority
  res.setHeader('Content-Type', MIME[extname(name).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('Content-Length', String(statSync(target).size))
  res.setHeader('Cache-Control', 'private, max-age=300')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  if (extname(name).toLowerCase() === '.html') {
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src " + origin + " 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; " +
      "style-src " + origin + " 'unsafe-inline'; img-src " + origin + " data: blob:; font-src " + origin + " data:; media-src " + origin + " data: blob:; " +
      'connect-src ' + origin + "; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'")
  }
  res.statusCode = 200
  if (req.method === 'HEAD') { res.end(); return }
  const stream = createReadStream(target)
  stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end() })
  stream.pipe(res)
}
