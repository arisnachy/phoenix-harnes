import { parseSmartForm, type SmartFormSpec } from './SmartFormEngine.ts'

/** Declarative visual data only. No JS, HTML, arbitrary commands or private remote URLs. */
export type VisualMode = 'auto' | 'table' | 'chart' | 'gallery' | 'bento'
  | 'comparison' | 'dashboard' | 'document' | 'form' | 'map'
export type VisualQuality = 'verified' | 'estimated' | 'unverified'
export type VisualCell = string | number | boolean | null
export type VisualMetric = { label: string; value: string; detail?: string; status?: 'positive' | 'warning' | 'negative' | 'info' | 'neutral' }
export type VisualSource = { title: string; url: string; checkedAt?: string; quality?: VisualQuality; note?: string }
export type VisualMedium = { title: string; kind: 'image' | 'video' | 'document' | 'product'; url: string; caption?: string; source?: string }
export type VisualPlace = { label: string; lat: number; lng: number; value?: number }
export type VisualSeries = { label: string; values: number[] }
export type VisualAction = { label: string; prompt: string; mode?: 'draft' | 'submit' }
export type VisualLive = { endpoint: string; intervalSeconds?: number }
export interface VisualIntelligenceSpec {
  readonly component: 'visual_intelligence'
  readonly version: 1
  readonly props: {
    readonly id: string
    readonly title: string
    readonly subtitle?: string
    readonly view?: VisualMode
    readonly columns?: string[]
    readonly rows?: VisualCell[][]
    readonly labels?: string[]
    readonly series?: VisualSeries[]
    readonly metrics?: VisualMetric[]
    readonly media?: VisualMedium[]
    readonly sources?: VisualSource[]
    readonly document?: { title: string; content: string; version?: number }
    readonly places?: VisualPlace[]
    readonly form?: SmartFormSpec
    readonly actions?: VisualAction[]
    readonly live?: VisualLive
  }
}

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const only = (v: Record<string, unknown>, fields: readonly string[]): boolean =>
  Object.keys(v).every(key => fields.includes(key))
const string = (v: unknown, length = 180): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= length
const maybe = (v: unknown, length = 180): boolean => v === undefined || string(v, length)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const quality = (v: unknown): boolean =>
  v === undefined || v === 'verified' || v === 'estimated' || v === 'unverified'
const cell = (v: unknown): v is VisualCell =>
  v === null || (typeof v === 'string' && v.length <= 800)
    || (typeof v === 'boolean') || (finite(v) && Math.abs(v) <= 1e12)
/** Only HTTPS destinations without embedded credentials, fragments or nonstandard ports. */
export function safeVisualUrl(v: unknown): v is string {
  if (!string(v, 1600)) return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && !u.hash && u.hostname.includes('.') && !/^(?:localhost|127\.|10\.|192\.168\.)/.test(u.hostname)
  } catch { return false }
}
const safeImageHosts = new Set([
  'a.espncdn.com', 'cdn.nba.com', 'upload.wikimedia.org', 'images.unsplash.com',
  'images.pexels.com', 'images.nasa.gov', 'cdn.pixabay.com',
])
/** Untrusted model-authored media never triggers a request to an arbitrary origin. */
export function isVisualImageUrl(v: unknown): v is string {
  if (!safeVisualUrl(v)) return false
  return safeImageHosts.has(new URL(v).hostname.toLowerCase())
}
export function isVisualLiveEndpoint(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 280
    && /^\/api\/[a-z0-9][a-z0-9/_?=.&-]*$/i.test(v)
    && !v.includes('..') && !v.includes('//')
}
function validateTable(p: Record<string, unknown>): boolean {
  if (p.columns === undefined && p.rows === undefined) return true
  return Array.isArray(p.columns) && p.columns.length > 0 && p.columns.length <= 16
    && p.columns.every(v => string(v, 70))
    && new Set(p.columns).size === p.columns.length
    && Array.isArray(p.rows) && p.rows.length > 0 && p.rows.length <= 500
    && p.rows.every(row => Array.isArray(row) && row.length === p.columns.length && row.every(cell))
}
function validateChart(p: Record<string, unknown>): boolean {
  if (p.labels === undefined && p.series === undefined) return true
  return Array.isArray(p.labels) && p.labels.length >= 2 && p.labels.length <= 120
    && p.labels.every(v => string(v, 75))
    && Array.isArray(p.series) && p.series.length >= 1 && p.series.length <= 6
    && p.series.every(s => object(s) && only(s, ['label', 'values'])
      && string(s.label, 80) && Array.isArray(s.values) && s.values.length === p.labels.length
      && s.values.every(v => finite(v) && Math.abs(v) <= 1e12))
}
const allowedModes: readonly VisualMode[] = [
  'auto','table','chart','gallery','bento','comparison','dashboard','document','form','map',
]
/** Strict schema with bounds, provenance, guarded URLs and data-shape checks. */
export function parseVisualIntelligence(v: unknown): VisualIntelligenceSpec | null {
  if (!object(v) || !only(v, ['component', 'version', 'props'])
      || v.component !== 'visual_intelligence' || v.version !== 1 || !object(v.props)) return null
  const p = v.props
  if (!only(p, ['id','title','subtitle','view','columns','rows','labels','series','metrics',
    'media','sources','document','places','form','actions','live'])
    || !string(p.id, 64) || !/^[a-z][a-z0-9_-]{1,63}$/.test(p.id)
    || !string(p.title, 140) || !maybe(p.subtitle, 350)
    || (p.view !== undefined && !allowedModes.includes(p.view as VisualMode))
    || !validateTable(p) || !validateChart(p)) return null
  if (p.metrics !== undefined && (!Array.isArray(p.metrics) || p.metrics.length > 24
      || !p.metrics.every(m => object(m) && only(m, ['label','value','detail','status'])
        && string(m.label, 120) && string(m.value, 160) && maybe(m.detail, 300)
        && (m.status === undefined || ['positive','warning','negative','info','neutral'].includes(String(m.status)))))) return null
  if (p.media !== undefined && (!Array.isArray(p.media) || p.media.length > 32
      || !p.media.every(m => object(m) && only(m, ['title','kind','url','caption','source'])
        && string(m.title, 140) && ['image','video','document','product'].includes(String(m.kind))
        && safeVisualUrl(m.url) && (m.kind !== 'image' || isVisualImageUrl(m.url))
        && maybe(m.caption, 420) && maybe(m.source, 220)))) return null
  if (p.sources !== undefined && (!Array.isArray(p.sources) || p.sources.length > 24
      || !p.sources.every(s => object(s) && only(s, ['title','url','checkedAt','quality','note'])
        && string(s.title, 180) && safeVisualUrl(s.url)
        && maybe(s.checkedAt, 36) && quality(s.quality) && maybe(s.note, 420)))) return null
  if (p.places !== undefined && (!Array.isArray(p.places) || p.places.length > 20
      || !p.places.every(x => object(x) && only(x, ['label','lat','lng','value'])
        && string(x.label, 120) && finite(x.lat) && x.lat >= -90 && x.lat <= 90
        && finite(x.lng) && x.lng >= -180 && x.lng <= 180
        && (x.value === undefined || finite(x.value))))) return null
  if (p.document !== undefined && (!object(p.document)
      || !only(p.document, ['title','content','version']) || !string(p.document.title, 150)
      || typeof p.document.content !== 'string' || p.document.content.length > 20000
      || (p.document.version !== undefined && (!Number.isInteger(p.document.version)
        || (p.document.version as number) < 1)))) return null
  if (p.form !== undefined && parseSmartForm(p.form) === null) return null
  if (p.actions !== undefined && (!Array.isArray(p.actions) || p.actions.length > 10
      || !p.actions.every(a => object(a) && only(a, ['label','prompt','mode'])
        && string(a.label, 110) && string(a.prompt, 1200)
        && (a.mode === undefined || a.mode === 'draft' || a.mode === 'submit')))) return null
  if (p.live !== undefined && (!object(p.live) || !only(p.live, ['endpoint','intervalSeconds'])
      || !isVisualLiveEndpoint(p.live.endpoint)
      || (p.live.intervalSeconds !== undefined
        && (!Number.isInteger(p.live.intervalSeconds) || (p.live.intervalSeconds as number) < 20
          || (p.live.intervalSeconds as number) > 600)))) return null
  if (![p.rows,p.series,p.metrics,p.media,p.sources,p.document,p.places,p.form,p.live].some(x => x !== undefined)) return null
  return v as unknown as VisualIntelligenceSpec
}
/** Deterministic, inspectable UI choice. A user may override this from the view switcher. */
export function chooseVisualView(p: VisualIntelligenceSpec['props']): Exclude<VisualMode,'auto'> {
  if (p.form) return 'form'
  if (p.places?.length) return 'map'
  if (p.document) return 'document'
  if (p.media?.length) return p.media.length >= 4 ? 'bento' : 'gallery'
  if (p.series?.length) return 'chart'
  if (p.rows?.length) return p.rows.length > 10 ? 'table' : 'comparison'
  return 'dashboard'
}
/** Users should see why a generated surface is not actionable. */
export function auditVisualIntelligence(spec: VisualIntelligenceSpec): string[] {
  const p = spec.props, issues: string[] = []
  if (p.series && p.series.length !== 0 && !p.sources?.length) issues.push('La gráfica no incluye fuentes verificables.')
  if (p.places && !p.sources?.length) issues.push('La procedencia de las ubicaciones no está documentada.')
  if (p.live) issues.push('La conexión en vivo solo se confirma después de una respuesta real del servidor.')
  if (p.actions && p.actions.some(a => a.mode === 'submit')) issues.push('Las acciones externas requieren autorización del sistema anfitrión.')
  if (p.sources?.some(s => s.quality === 'unverified')) issues.push('Hay fuentes declaradas como no verificadas.')
  if (p.rows?.some(r => r.every(v => v === null || v === ''))) issues.push('La tabla contiene filas vacías.')
  return issues
}
/** CSV formula injection is neutralized before passing cells to spreadsheet software. */
function exportCell(value: VisualCell): string {
  const raw = value === null ? '' : String(value)
  return /^[\s]*[=+@-]/.test(raw) && typeof value === 'string' ? "'" + raw : raw
}
export function visualCsv(columns: readonly string[], rows: readonly (readonly VisualCell[])[]): string {
  const esc = (v: string): string => '"' + v.replace(/"/g, '""') + '"'
  return '\uFEFF' + [columns.map(esc).join(','), ...rows.map(row =>
    row.map(c => esc(exportCell(c))).join(','))].join('\r\n')
}
export function visualExcelXml(columns: readonly string[], rows: readonly (readonly VisualCell[])[]): string {
  const x = (s: string): string => s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'')
  const row = (r: readonly VisualCell[]): string => '<Row>' + r.map(v =>
    '<Cell><Data ss:Type="' + (typeof v === 'number' ? 'Number' : 'String') + '">'
    + x(exportCell(v)) + '</Data></Cell>').join('') + '</Row>'
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"'
    + ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Datos">'
    + '<Table>' + row(columns) + rows.map(row).join('') + '</Table></Worksheet></Workbook>'
}
