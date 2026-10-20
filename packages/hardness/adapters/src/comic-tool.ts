import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'

/** A static comic edition rendered as an isolated inline chat artifact, never as browser navigation. */
export const PHOENIX_COMIC_MIME = 'application/vnd.phoenix.comic+html'
const MAX_BYTES = 24 * 1024 * 1024
const KEY = /^[a-z][a-z0-9-]{1,63}$/u
const SHA = /^[a-f0-9]{64}$/u
function reject(reason: string): never { throw new ToolArgsError([reason]) }

/** Validate genuine sequential raster panels, not perceptual identity or editorial quality.
 * @param html - Self-contained rendered comic HTML.
 * @returns Observed page and panel counts for a publishable static edition.
 */
export function validateComicHtml(html: string): { pages: number; panels: number } {
  if (typeof html !== 'string' || Buffer.byteLength(html) > MAX_BYTES
    || !/<!doctype html>/iu.test(html) || !/<html\b/iu.test(html) || !/<body\b/iu.test(html)) {
    return reject('Comic Studio: HTML completo requerido (máximo 24 MiB).')
  }
  if (/<(?:iframe|frameset|frame|object|embed|base|form|script)\b/iu.test(html)
    || /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/iu.test(html)
    || /(?:https?:\/\/|file:\/\/|localhost\b|127\.0\.0\.1\b|window\.location)/iu.test(html)) {
    return reject('Comic Studio: no se admite navegación, Phoenix dentro de Phoenix, scripts ni recursos de red.')
  }
  const pages = [...html.matchAll(/<section\b[^>]*class\s*=\s*["'][^"']*\bcomic-page\b[^"']*["'][^>]*>/giu)]
  const panels = [...html.matchAll(/<article\b[^>]*class\s*=\s*["'][^"']*\bpanel\b[^"']*["'][^>]*>[\s\S]*?<\/article>/giu)]
  for (const side of ['front', 'back']) {
    const mark = new RegExp('<section\\b[^>]*data-comic-cover="' + side + '"[^>]*>([\\s\\S]*?)<\\/section>', 'iu')
    const cover = mark.exec(html)
    if (!cover || !/<img\\b[^>]*\\bsrc\\s*=\\s*(["'])data:image\\/(png|jpeg|webp);base64,[A-Za-z0-9+/]{100,}={0,2}\\1/iu.test(cover[1]!)) {
      return reject('Comic Studio: faltan imágenes reales de portada y contraportada; no se permite publicar una edición incompleta.')
    }
  }
  if (pages.length < 1 || pages.length > 100 || panels.length < pages.length || panels.length > 600) {
    return reject('Comic Studio: faltan páginas con viñetas reales.')
  }
  for (let i = 0; i < panels.length; i++) {
    const img = /<img\b[^>]*\bsrc\s*=\s*(["'])data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})\1[^>]*>/iu.exec(panels[i]![0])
    const encoded = img?.[3]
    if (!encoded || encoded.length < 100 || encoded.length % 4 !== 0) {
      return reject('Comic Studio: falta ilustración incrustada en viñeta ' + (i + 1))
    }
    const bytes = Buffer.from(encoded, 'base64')
    const format = img?.[2]?.toLowerCase()
    if (bytes.length < 100 || bytes.toString('base64') !== encoded
      || (format === 'png' && (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        || bytes.length < 65 || bytes.toString('ascii', 12, 16) !== 'IHDR'
        || !bytes.includes(Buffer.from('IDAT')) || !bytes.includes(Buffer.from('IEND'))
        || bytes.readUInt32BE(16) < 128 || bytes.readUInt32BE(20) < 128))
      || (format === 'jpeg' && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9))
      || (format === 'webp' && !(bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'))) {
      return reject('Comic Studio: imagen simulada, ilegible o diminuta en viñeta ' + (i + 1))
    }
  }
  if (/class=["'][^"']*\bmissing\b/iu.test(html) || /arte pendiente|imagen pendiente|placeholder/iu.test(html)) {
    return reject('Comic Studio: la entrega tiene ilustraciones pendientes.')
  }
  return { pages: pages.length + 2, panels: panels.length }
}

function readHtml(path: string): string {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size < 100 || stat.size > MAX_BYTES) return reject('Comic Studio: archivo vacío o mayor de 24 MiB.')
  return readFileSync(path, 'utf8')
}

/** Read only HTML inside the agent workspace, resolving symlinks before authorization.
 * @param path - Workspace-relative or contained absolute HTML path.
 * @param cwd - Owner agent's workspace directory.
 * @returns UTF-8 source bytes of the admitted comic edition.
 */
export function readWorkspaceComicHtml(path: string, cwd: string): string {
  if (typeof path !== 'string' || !/\.html$/iu.test(path) || path.length > 4096
    || /[\u0000-\u001f]/u.test(path) || !cwd) return reject('Comic Studio: file_path inválido.')
  let root: string, target: string
  try { root = realpathSync(cwd); target = realpathSync(resolve(root, path)) }
  catch { return reject('Comic Studio: no existe el archivo HTML en el workspace.') }
  const child = relative(root, target)
  if (!child || child === '..' || child.startsWith('..' + sep)
    || isAbsolute(child) || extname(target).toLowerCase() !== '.html') {
    return reject('Comic Studio: archivo externo al workspace.')
  }
  return readHtml(target)
}

/** Reopen a non-draft Comic Studio release and verify its recorded SHA-256.
 * @param seriesId - Durable series identifier.
 * @param issueId - Durable issue identifier.
 * @returns Unchanged HTML edition from persistent storage.
 */
export function readComicRelease(seriesId: string, issueId: string): string {
  if (!KEY.test(seriesId) || !KEY.test(issueId)) return reject('Comic Studio: identificadores inválidos.')
  const home = resolve(process.env.PHOENIX_COMICS_HOME
    || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'comic-studio'))
  const folder = join(home, 'series', seriesId, 'releases', issueId)
  const manifestFile = join(folder, 'release.json'), htmlFile = join(folder, 'comic.html')
  try {
    if (realpathSync(manifestFile) !== manifestFile || realpathSync(htmlFile) !== htmlFile) {
      return reject('Comic Studio: no se admiten symlinks para ediciones.')
    }
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>
    const digests = manifest.sha256 as Record<string, unknown> | undefined
    if (manifest.seriesId !== seriesId || manifest.issueId !== issueId
      || manifest.structurallyValid !== true || manifest.draft !== false || manifest.editorialComplete !== true
      || !Array.isArray(manifest.formats) || !manifest.formats.includes('html')
      || typeof digests?.html !== 'string' || !SHA.test(digests.html)) {
      return reject('Comic Studio: la edición todavía no tiene un recibo editorial válido.')
    }
    const html = readHtml(htmlFile)
    if (createHash('sha256').update(html).digest('hex') !== digests.html) {
      return reject('Comic Studio: HTML modificado después del recibo editorial.')
    }
    return html
  } catch (error) {
    if (error instanceof ToolArgsError) throw error
    return reject('Comic Studio: edición ausente o recibo inválido.')
  }
}

/** Create the governed model-facing publisher for direct inline comic artifacts.
 * @returns Phoenix Comic Studio tool definition with structural admission checks.
 */
export function createPhoenixComicTool(): ToolDefinition {
  return defineTool({
    name: 'phoenix_comic',
    description: 'Actual in-chat comic publisher for requests like "dame una demo de un cómic", "crea un manga", "haz una historieta" and "continúa mi cómic". Kira creates illustrated pages through genuine image generation and Comic Studio, then MUST invoke phoenix_comic. NEVER navigate to 127.0.0.1:3080, localhost or Phoenix itself in MiniBrowser to make a comic. NEVER say published without a successful artifact receipt. Prefer series_id+issue_id of an audited non-draft Comic Studio release; alternatively use file_path of existing self-contained comic HTML in the session workspace or inline html. The publisher rejects missing artwork, empty panels and navigational HTML. No need to use MiniBrowser, phoenix_game or arbitrary navigation. The model creates the artwork separately; this tool does not synthesize images. If no real image generator is available, report the precise limitation; do not fake a comic. Passing this structural preflight does NOT certify same-looking characters or artistic quality.',
    parameters: {
      title: { type: 'string', required: true, description: 'Visible comic issue title.' },
      series_id: { type: 'string', description: 'Persistent comic series ID, paired with issue_id.' },
      issue_id: { type: 'string', description: 'Persistent issue ID of a rendered and audited release.' },
      file_path: { type: 'string', description: 'Existing self-contained comic HTML inside the current workspace.' },
      html: { type: 'string', description: 'Optional inline illustrated HTML; real embedded raster artwork required.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        artifactId: { type: 'string', required: true },
        title: { type: 'string', required: true },
        pages: { type: 'number', required: true },
        panels: { type: 'number', required: true },
        html: { type: 'string', required: true },
      } },
      render: (_args, result) => [{ type: 'text',
        text: 'Comic Studio: "' + result.title + '" publicado en el chat con '
          + result.pages + ' páginas y ' + result.panels
          + ' viñetas ilustradas. Preflight estructural aprobado; calidad visual pendiente de revisión.' }],
      presentationMeta: (_args, result) => ({ artifact: {
        id: result.artifactId, title: result.title, mime: PHOENIX_COMIC_MIME,
        data: result.html, executable: false,
      } }),
    },
    execute(args, exec) {
      const title = args.title.trim()
      if (!title || title.length > 160) return Promise.reject(new ToolArgsError(['Comic Studio: título inválido.']))
      const fromRelease = typeof args.series_id === 'string' || typeof args.issue_id === 'string'
      const fromFile = typeof args.file_path === 'string'
      const fromInline = typeof args.html === 'string'
      if (Number(fromRelease) + Number(fromFile) + Number(fromInline) !== 1
        || (fromRelease && (typeof args.series_id !== 'string' || typeof args.issue_id !== 'string'))) {
        return Promise.reject(new ToolArgsError(['Comic Studio: usa series_id + issue_id, file_path o html (uno solamente).']))
      }
      exec.signal.throwIfAborted()
      const html = fromRelease ? readComicRelease(args.series_id!, args.issue_id!)
        : fromFile ? readWorkspaceComicHtml(args.file_path!, exec.agent?.session.header.cwd ?? '')
          : args.html!
      const counts = validateComicHtml(html)
      exec.signal.throwIfAborted()
      return Promise.resolve({ artifactId: 'phoenix-comic:' + String(exec.callId), title, ...counts, html })
    },
    presentCall(args) {
      return { card: 'generic', title: 'Comic Studio · ' + args.title,
        kind: 'read', rawInput: 'Publicación ilustrada en el chat; sin MiniBrowser' }
    },
  })
}
