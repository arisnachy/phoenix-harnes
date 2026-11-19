/**
 * Safe host-owned distribution of real Blender Studio assets.
 * No scripts or arbitrary workspace HTML are served to the browser.
 */
import { randomBytes } from 'node:crypto'
import { closeSync, copyFileSync, createReadStream, existsSync, mkdirSync, openSync, readSync,
  realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const PHOENIX_STUDIO3D_MIME = 'application/vnd.phoenix.studio3d+json'
const ROUTE = '/phoenix-studio3d/assets'
const ROOT = join(homedir(), '.dsh', 'studio3d-assets')
const TOKEN = /^[0-9a-f]{48}$/u
const FILES = {
  'render.png': { extension: '.png', max: 32_000_000, mime: 'image/png' },
  'scene.glb': { extension: '.glb', max: 500_000_000, mime: 'model/gltf-binary' },
  'scene.blend': { extension: '.blend', max: 500_000_000, mime: 'application/octet-stream' },
  'animation.mp4': { extension: '.mp4', max: 300_000_000, mime: 'video/mp4' },
} as const
type StudioFileName = keyof typeof FILES
type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
export interface Studio3DWebHost {
  register(route: { readonly kind: 'prefix'; readonly path: string; readonly handler: HttpHandler }): () => void
}
export interface Studio3DBundleReceipt {
  readonly renderUrl: string
  readonly modelUrl: string
  readonly projectUrl: string
  readonly animationUrl?: string
  readonly sizeBytes: number
  readonly engine: 'blender'
  readonly verifiedFiles: readonly string[]
  readonly viewportVerified: false
}
let mounted = false
/** Resolve only real files beneath the agent workspace; symlinks cannot escape. */
export function resolveStudio3DWorkspaceFile(root: string, file: string, extension: string): string {
  if (typeof root !== 'string' || !root.trim() || typeof file !== 'string' || !file.trim()
    || file.includes('\0')) throw new Error('Studio 3D: falta un archivo dentro del workspace.')
  const workspace = realpathSync(root)
  const actual = realpathSync(resolve(workspace, file))
  const child = relative(workspace, actual)
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)
    || extname(actual).toLowerCase() !== extension || !statSync(actual).isFile()) {
    throw new Error('Studio 3D: ruta fuera del workspace o extensión inválida.')
  }
  return actual
}
function magic(file: string, bytes: number): Buffer {
  const fd = openSync(file, 'r')
  const data = Buffer.alloc(bytes)
  try {
    if (readSync(fd, data, 0, bytes, 0) !== bytes) throw new Error('Studio 3D: archivo truncado.')
  } finally { closeSync(fd) }
  return data
}
export function inspectStudio3DAsset(file: string, kind: StudioFileName): number {
  const value = FILES[kind]
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error('Studio 3D: falta ' + kind)
  const length = statSync(file).size
  if (length < 16 || length > value.max) throw new Error('Studio 3D: tamaño inválido en ' + kind)
  const header = magic(file, 16)
  const valid = kind === 'render.png'
    ? header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : kind === 'scene.glb'
      ? header.subarray(0,4).toString('ascii') === 'glTF'
        && header.readUInt32LE(4) === 2 && header.readUInt32LE(8) === length
      : kind === 'scene.blend'
        ? header.subarray(0,7).toString('ascii') === 'BLENDER'
        : header.subarray(4,8).toString('ascii') === 'ftyp'
  if (!valid) throw new Error('Studio 3D: cabecera inválida para ' + kind)
  return length
}
/** Only the Host publishes; no agent may mount a second route. */
export function mountStudio3DAssets(server: Studio3DWebHost): () => void {
  if (mounted) return () => {}
  const dispose = server.register({ kind:'prefix', path:ROUTE, handler:serveStudio3DAsset })
  mounted = true
  return () => { mounted = false; dispose() }
}
/** Create an immutable, unguessable read-only bundle of verified Blender outputs. */
export function publishStudio3DAssets(outputPath: string, workspace: string): Studio3DBundleReceipt {
  if (!mounted) throw new Error('Studio 3D: el servidor de activos todavía no está montado.')
  const folder = resolveStudio3DWorkspaceFile(workspace, join(outputPath, 'render.png'), '.png')
  const directory = dirname(folder)
  const required: StudioFileName[] = ['render.png','scene.glb','scene.blend']
  const names: StudioFileName[] = [...required, ...(existsSync(join(directory,'animation.mp4'))?['animation.mp4' as const]:[])]
  const files = names.map(name => {
    const actual = resolveStudio3DWorkspaceFile(workspace, join(outputPath,name), FILES[name].extension)
    return { name, actual, length:inspectStudio3DAsset(actual,name) }
  })
  const bytes = files.reduce((sum,f)=>sum+f.length,0)
  mkdirSync(ROOT,{recursive:true,mode:0o700})
  const token = randomBytes(24).toString('hex')
  const dir = join(ROOT,token)
  mkdirSync(dir,{mode:0o700})
  try {
    for (const f of files) copyFileSync(f.actual,join(dir,f.name))
    writeFileSync(join(dir,'manifest.phoenix.json'),
      JSON.stringify({bytes,files:names}),{flag:'wx',mode:0o600})
  } catch (error) { rmSync(dir,{recursive:true,force:true}); throw error }
  const prefix = ROUTE+'/'+token+'/'
  return {
    renderUrl:prefix+'render.png',modelUrl:prefix+'scene.glb',projectUrl:prefix+'scene.blend',
    ...(names.includes('animation.mp4')?{animationUrl:prefix+'animation.mp4'}:{}),
    sizeBytes:bytes, engine:'blender',verifiedFiles:names,viewportVerified:false,
  }
}
/** Serves exclusively known raster/model/video assets from a private token folder. */
export function serveStudio3DAsset(req: IncomingMessage, res: ServerResponse): void {
  let url: URL
  try { url = new URL(req.url??'/', 'http://127.0.0.1') }
  catch { res.writeHead(404).end(); return }
  const parts = url.pathname.split('/').filter(Boolean)
  const prefix = ROUTE.split('/').filter(Boolean)
  const token = parts[prefix.length]
  const filename = parts[prefix.length+1]
  if (parts.length !== prefix.length+2 || parts.slice(0,prefix.length).join('/') !== prefix.join('/')
    || token === undefined || !TOKEN.test(token)
    || filename === undefined || !Object.hasOwn(FILES,filename)) {
    res.writeHead(404).end(); return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
  const name = filename as StudioFileName
  let target: string
  try {
    const dir = realpathSync(join(ROOT,token))
    target = realpathSync(join(dir,name))
    if (dirname(target) !== dir) throw Error('Invalid path')
    inspectStudio3DAsset(target,name)
  } catch { res.writeHead(404).end(); return }
  res.setHeader('Content-Type',FILES[name].mime)
  res.setHeader('Content-Length',String(statSync(target).size))
  res.setHeader('Cache-Control','private, max-age=300')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'")
  res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('Cross-Origin-Resource-Policy','same-origin')
  if (name === 'scene.blend' || name === 'scene.glb') {
    res.setHeader('Content-Disposition','attachment; filename="'+name+'"')
  }
  res.statusCode = 200
  if (req.method === 'HEAD') {res.end();return}
  const stream = createReadStream(target)
  stream.on('error',()=>{if(!res.headersSent)res.writeHead(500);res.end()})
  stream.pipe(res)
}
