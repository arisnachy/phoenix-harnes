/** Resolve image assets bundled with a HARDNESS HTML mini-app without exposing
 * arbitrary host paths or relaxing the isolated preview's network policy.
 */
type AssetMap = Readonly<Record<string, unknown>>

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
}
const IMAGE_DATA = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/iu
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u
const MAX_ASSET_CHARS = 12 * 1024 * 1024

function normalizedPath(value: string): string | undefined {
  const path = value.replace(/\\/gu, '/').replace(/^\/+/, '')
  if (path.length === 0 || path.includes('\0')) return undefined
  const parts: string[] = []
  for (const item of path.split('/')) {
    if (item === '' || item === '.') continue
    if (item === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
    } else {
      parts.push(item)
    }
  }
  return parts.length === 0 ? undefined : parts.join('/')
}

function assetUri(path: string, raw: unknown): string | undefined {
  const ext = /\.([^.]+)$/u.exec(path)?.[1]?.toLowerCase()
  const mime = ext === undefined ? undefined : MIME_BY_EXTENSION[ext]
  if (mime === undefined) return undefined
  let value: unknown = raw
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const record = raw as Readonly<Record<string, unknown>>
    const declared = record.mime ?? record.mediaType
    if (declared !== undefined && declared !== mime) return undefined
    value = record.base64 ?? record.data
  }
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ASSET_CHARS) return undefined
  if (IMAGE_DATA.test(value)) return value.startsWith('data:' + mime + ';') ? value : undefined
  if (!BASE64.test(value) || value.length % 4 !== 0) return undefined
  return 'data:' + mime + ';base64,' + value
}

/** Replace only references to known bundled raster images.
 * Bare URLs, absolute host paths, traversal outside the bundle, and unknown
 * files are never converted into network requests.
 * @param entry - Relative path of the entry HTML document.
 * @param html - Entry document contents.
 * @param files - Companion files indexed by relative path.
 * @param includeStylesheets - Whether to embed companion stylesheets.
 * @returns HTML with matching bundled image references embedded.
 */
export function inlineBundledImages(entry: string, html: string, files: AssetMap, includeStylesheets = true): string {
  const normalizedEntry = normalizedPath(entry)
  if (normalizedEntry === undefined) return html
  const directory = normalizedEntry.includes('/') ? normalizedEntry.slice(0, normalizedEntry.lastIndexOf('/') + 1) : ''
  const resources = new Map<string, string>()
  for (const [name, raw] of Object.entries(files)) {
    const normalized = normalizedPath(name)
    if (normalized === undefined) continue
    const uri = assetUri(normalized, raw)
    if (uri !== undefined) resources.set(normalized, uri)
  }
  const resolve = (reference: string): string | undefined => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(reference)) return undefined
    let decoded: string
    try { decoded = decodeURIComponent(reference.split(/[?#]/u, 1)[0] ?? '') } catch { return undefined }
    const key = normalizedPath(reference.startsWith('/') ? decoded : directory + decoded)
    return key === undefined ? undefined : resources.get(key)
  }
  // Quoted HTML asset attributes, including picture/srcset (single-candidate).
  let output = html.replace(/\b(src|poster|href)\s*=\s*(["'])(.*?)\2/giu, (original, attribute: string, quote: string, raw: string) => {
    // Only resource-bearing attributes are altered. Links to other documents
    // remain regular links rather than becoming navigable data URLs.
    if (attribute.toLowerCase() === 'href' && !/\.(?:png|jpe?g|gif|webp)(?:[?#]|$)/iu.test(raw)) return original
    const uri = resolve(raw)
    return uri === undefined ? original : attribute + '=' + quote + uri + quote
  })
  output = output.replace(/\b(srcset)\s*=\s*(["'])(.*?)\2/giu, (_original: string, attribute: string, quote: string, raw: string) => {
    const candidates = raw.split(',').map((candidate) => {
      const matched = /^(\s*)(\S+)(\s+.*)?$/u.exec(candidate)
      if (matched === null) return candidate
      const uri = resolve(matched[2] ?? '')
      return uri === undefined ? candidate : (matched[1] ?? '') + uri + (matched[3] ?? '')
    })
    return attribute + '=' + quote + candidates.join(',') + quote
  })
  output = output.replace(/url\(\s*(["']?)([^'"()]+)\1\s*\)/giu, (original, _quote: string, raw: string) => {
    const uri = resolve(raw.trim())
    return uri === undefined ? original : 'url("' + uri + '")'
  })
  if (!includeStylesheets) return output
  // Inline only actual CSS files shipped with this same artifact, preserving
  // their own relative image paths. Remote stylesheets remain blocked.
  return output.replace(/<link\b[^>]*>/giu, (original) => {
    if (!/\brel\s*=\s*(["'])stylesheet\1/iu.test(original)) return original
    const match = /\bhref\s*=\s*(["'])(.*?)\1/iu.exec(original)
    const reference = match?.[2]
    if (reference === undefined || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/iu.test(reference)) return original
    const cssReference = reference.split(/[?#]/u, 1)[0] ?? ''
    const key = normalizedPath(reference.startsWith('/') ? cssReference : directory + cssReference)
    if (key === undefined || !/\.css$/iu.test(key)) return original
    const css = files[key]
    if (typeof css !== 'string' || css.length > MAX_ASSET_CHARS) return original
    const safeCss = inlineBundledImages(key, css, files, false).replace(/<\/style/giu, '<\\/style')
    return '<style data-phoenix-bundled-css="true">' + safeCss + '</style>'
  })
}

/** Identify remote image requests that require consent in executable HTML.
 * Scripts retain connect-src 'none', but can request images once authorized.
 * @param html - HTML document contents.
 * @returns Whether remote image references are present.
 */
export function hasExternalImageReferences(html: string): boolean {
  return /(?:https?:)?\/\//iu.test(html)
    && /(?:<img\b|<picture\b|\bsrcset\b|background-image|image\s*\(|new\s+Image\s*\(|createElement\(\s*['"]img)/iu.test(html)
}
/** Detect authored JavaScript that requires a script-capable sandbox.
 * @param html - HTML document contents.
 * @returns Whether the document carries executable author code.
 */
export function hasExecutableHtmlBehavior(html: string): boolean {
  return /<script\b|\bon[a-z][a-z\d_-]*\s*=|\b(?:java|vb)script\s*:/iu.test(html)
}

/**
 * Standalone browser-tab shell for an untrusted HTML artifact.  The opaque-origin
 * sandboxed iframe is essential: a blob: URL inherits Phoenix's origin and
 * MUST NOT run authored HTML directly in the top-level document.
 */
export function isolatedHtmlPreviewWindow(documentHtml: string, title: string, executable: boolean): string {
  const escapeAttribute = (value: string): string => value.replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
  const safeTitle = escapeAttribute(title)
  const sandbox = executable ? 'allow-scripts' : ''
  return '<!doctype html><html lang="es"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
    + 'style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; frame-src \'self\' blob: about:; '
    + 'img-src data: blob: https: http:; font-src data:; media-src data: blob:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">'
    + '<title>' + safeTitle + '</title>'
    + '<style>html,body{height:100%;margin:0;background:#faf8f5}'
    + 'iframe{display:block;box-sizing:border-box;width:100%;height:100%;border:0}'
    + '</style></head><body><iframe title="' + safeTitle + '" sandbox="' + sandbox
    + '" referrerpolicy="no-referrer" srcdoc="' + escapeAttribute(documentHtml)
    + '"></iframe></body></html>'
}
