/**
 * Fast, attributable web imagery for PHOENIX intelligent UIs.
 *
 * Wikimedia Commons is a public no-key source, not an image-generation service.
 * The fixed upstream origin prevents a model-supplied URL from becoming an SSRF
 * destination. All returned visuals retain the original file page and license.
 */
import { defineTool, ToolArgsError, type ToolDefinition } from '@phoenix-ai/dsh-tools'

export interface CommonsReferenceImage {
  readonly src: string
  readonly alt: string
  readonly sourceUrl: string
  readonly credit: string
  readonly license: string
  readonly licenseUrl?: string
}

interface CommonsMetadataItem { readonly value?: unknown }
interface CommonsImageInfo {
  readonly mime?: unknown
  readonly thumbmime?: unknown
  readonly thumburl?: unknown
  readonly descriptionurl?: unknown
  readonly extmetadata?: Readonly<Record<string, CommonsMetadataItem>>
}
interface CommonsPage {
  readonly title?: unknown
  readonly index?: unknown
  readonly imageinfo?: readonly CommonsImageInfo[]
}

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
export const COMMONS_IMAGE_SEARCH_TIMEOUT_MS = 8_000
const ALLOWED_RASTER_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeHttps(value: unknown, hostname?: string): string | undefined {
  if (typeof value !== 'string' || value.length > 1800) return undefined
  try {
    const uri = new URL(value)
    if (uri.protocol !== 'https:' || uri.username || uri.password) return undefined
    if (hostname !== undefined && uri.hostname !== hostname) return undefined
    return uri.href
  } catch {
    return undefined
  }
}

function stripMetadataHtml(value: unknown, limit = 160): string | undefined {
  if (typeof value !== 'string' || value.length > 16000) return undefined
  const plain = value
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(?:nbsp|amp|quot|lt|gt|apos);/giu, entity => ({
      '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&apos;': "'",
    })[entity.toLowerCase() as '&nbsp;' | '&amp;' | '&quot;' | '&lt;' | '&gt;' | '&apos;'] ?? ' ')
    .replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/giu, (_match, hex: string | undefined, decimal: string | undefined) => {
      const code = Number.parseInt(hex ?? decimal ?? '0', hex ? 16 : 10)
      return code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
    })
    .replace(/\s+/gu, ' ')
    .trim()
  return plain.length > 0 ? plain.slice(0, limit) : undefined
}

/** Validate and project provider data before it can enter a model-authored UI. */
export function projectCommonsImages(payload: unknown, limit = 4): CommonsReferenceImage[] {
  if (!record(payload) || !record(payload.query)) return []
  const raw = payload.query.pages
  const pages = (Array.isArray(raw) ? raw : record(raw) ? Object.values(raw) : [])
    .filter((value): value is CommonsPage => record(value))
    .sort((a, b) => (typeof a.index === 'number' ? a.index : 9999) - (typeof b.index === 'number' ? b.index : 9999))
  const result: CommonsReferenceImage[] = []
  const seen = new Set<string>()
  for (const page of pages) {
    const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : undefined
    if (info === undefined || !ALLOWED_RASTER_MIME.has(String(info.mime))) continue
    const image = safeHttps(info.thumburl, 'upload.wikimedia.org')
    const sourceUrl = safeHttps(info.descriptionurl, 'commons.wikimedia.org')
    const license = stripMetadataHtml(info.extmetadata?.LicenseShortName?.value)
      ?? stripMetadataHtml(info.extmetadata?.UsageTerms?.value)
    if (image === undefined || sourceUrl === undefined || license === undefined || seen.has(image)) continue
    const title = typeof page.title === 'string'
      ? page.title.replace(/^File:/iu, '').replace(/\.[a-z0-9]{2,5}$/iu, '').replace(/_/gu, ' ').trim()
      : 'Imagen de Wikimedia Commons'
    if (title.length === 0) continue
    const credit = stripMetadataHtml(info.extmetadata?.Artist?.value) ?? 'Autor no especificado en metadatos'
    const licenseUrl = safeHttps(info.extmetadata?.LicenseUrl?.value)
    result.push({
      src: image,
      alt: title.slice(0, 180),
      sourceUrl,
      credit,
      license,
      ...(licenseUrl === undefined ? {} : { licenseUrl }),
    })
    seen.add(image)
    if (result.length >= Math.max(1, Math.min(limit, 6))) break
  }
  return result
}

/**
 * Search reusable existing references with a hard 8-second upstream budget.
 * This is not an SLA for image download/display or original AI generation.
 */
export async function searchCommonsImages(
  query: string,
  limit = 4,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<CommonsReferenceImage[]> {
  const search = query.trim()
  if (search.length < 3 || search.length > 180 || /[\u0000-\u001f]/u.test(search)) {
    throw new ToolArgsError(['La búsqueda de imágenes debe tener entre 3 y 180 caracteres.'])
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 6) {
    throw new ToolArgsError(['El límite de imágenes debe estar entre 1 y 6.'])
  }
  const url = new URL(COMMONS_API)
  url.search = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2',
    generator: 'search', gsrsearch: search, gsrnamespace: '6',
    gsrlimit: String(Math.max(8, limit * 2)),
    prop: 'imageinfo', iiprop: 'url|mime|extmetadata',
    iiurlwidth: '640', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|UsageTerms',
  }).toString()
  const budget = AbortSignal.timeout(COMMONS_IMAGE_SEARCH_TIMEOUT_MS)
  const response = await request(url.href, {
    signal: signal ? AbortSignal.any([signal, budget]) : budget,
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'PHOENIX-ReferenceImages/1.0 (https://github.com/arisnachy/phoenix-harnes)',
    },
  })
  if (!response.ok) throw new Error('Wikimedia Commons image search: HTTP ' + response.status)
  const body = await response.text()
  if (body.length > 512_000) throw new Error('Wikimedia Commons image search: oversized response')
  return projectCommonsImages(JSON.parse(body) as unknown, limit)
}

/** Model-facing tool, registered alongside web_search in the normal web suite. */
export function createWebImageSearchTool(): ToolDefinition {
  return defineTool({
    name: 'web_image_search',
    description: 'Find existing photographic or illustrative reference images from Wikimedia Commons without an API key. Optimized for quick intelligent UI placement: returns real thumbnail URLs, accurate file-page links, source credit and license; target under 10 seconds or fail explicitly. Do NOT claim an image was created by AI. To place an image in a PHOENIX generative-ui canvas, add a node {"type":"reference_image","src":result.src,"alt":result.alt,"sourceUrl":result.sourceUrl,"credit":result.credit,"license":result.license,"licenseUrl":result.licenseUrl} using values actually returned by this tool. A group layout="grid" can contain multiple reference_image nodes. Do not invent URLs, attribution, license or images. Use image_generation instead when the user needs original imagery or an edit of their own photograph.',
    parameters: {
      query: { type: 'string', required: true, description: 'Specific visual subject, 3–180 characters; use anatomical, geographic or product nouns, not long prose.' },
      limit: { type: 'integer', description: 'Number of results, 1–6, default 4.' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', required: true },
          provider: { type: 'string', required: true },
          images: {
            type: 'array', required: true,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value),
      }],
    },
    timeoutMs: 10_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const query = args.query.trim()
      const images = await searchCommonsImages(query, args.limit ?? 4, fetch, exec.signal)
      return { query, provider: 'Wikimedia Commons', images }
    },
  })
}
