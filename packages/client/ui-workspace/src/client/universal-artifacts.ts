import { createElement, type ReactNode } from 'react'

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export interface Candle {
  readonly time: number
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
}
export interface CustomArtifactBlock {
  readonly type: string
  readonly mime?: string
  readonly data: JsonValue
}
type BuiltinArtifactBlock =
  | { readonly type: 'markdown'; readonly text: string }
  | { readonly type: 'code'; readonly language: string; readonly text: string; readonly filename?: string }
  | { readonly type: 'image'; readonly src: string; readonly alt: string; readonly width?: number; readonly height?: number }
  | { readonly type: 'table'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly type: 'chart'; readonly spec: JsonValue }
  | { readonly type: 'candles'; readonly symbol: string; readonly interval: string; readonly points: readonly Candle[] }
  | { readonly type: 'map'; readonly spec: JsonValue }
  | { readonly type: 'document'; readonly mime: string; readonly text?: string; readonly url?: string }
  | { readonly type: 'file'; readonly filename: string; readonly mime: string; readonly text?: string; readonly url?: string }
  | { readonly type: 'app'; readonly entry: string; readonly files: Readonly<Record<string, string>> }
  | { readonly type: 'ui'; readonly schema: JsonValue }

export type ArtifactBlock = BuiltinArtifactBlock | CustomArtifactBlock

export interface UniversalArtifact {
  readonly id: string
  readonly title: string
  readonly status: 'experimental' | 'testing' | 'verified' | 'broken' | 'quarantined'
  readonly blocks: readonly ArtifactBlock[]
  readonly evidence: readonly unknown[]
  readonly version?: string
}

const SAFE_URL = /^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i
const FORBIDDEN_KEY = /^(execute|on[A-Z]|javascript|script|eval|srcDoc)$/
export type ArtifactBlockRenderer = (block: ArtifactBlock) => ReactNode
const renderers = new Map<string, ArtifactBlockRenderer>()

export function registerArtifactRenderer(type: string, renderer: ArtifactBlockRenderer): () => void {
  if (!/^[a-z][a-z0-9-]*$/.test(type)) throw new Error(`invalid artifact renderer type: ${type}`)
  const previous = renderers.get(type)
  renderers.set(type, renderer)
  return () => {
    if (previous === undefined) renderers.delete(type)
    else renderers.set(type, previous)
  }
}

export function validateUniversalArtifact(value: unknown): value is UniversalArtifact {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string' || !isStatus(value.status)
    || !Array.isArray(value.blocks) || !value.blocks.every(isBlock) || !Array.isArray(value.evidence)) return false
  return value.version === undefined || typeof value.version === 'string'
}

function isStatus(value: unknown): value is UniversalArtifact['status'] {
  return value === 'experimental' || value === 'testing' || value === 'verified' || value === 'broken' || value === 'quarantined'
}

function isBlock(value: unknown): value is ArtifactBlock {
  if (!isRecord(value) || typeof value.type !== 'string' || Object.keys(value).some(key => FORBIDDEN_KEY.test(key))) return false
  switch (value.type) {
    case 'markdown': return typeof value.text === 'string'
    case 'code': return typeof value.language === 'string' && typeof value.text === 'string' && optionalString(value.filename)
    case 'image': return typeof value.src === 'string' && SAFE_URL.test(value.src) && typeof value.alt === 'string' && optionalFinite(value.width) && optionalFinite(value.height)
    case 'table': {
      const columns = value.columns
      const rows = value.rows
      if (!Array.isArray(columns) || !columns.every(isString) || !Array.isArray(rows)) return false
      return rows.every(row => Array.isArray(row) && row.length === columns.length && row.every(isString))
    }
    case 'chart': return isJson(value.spec)
    case 'candles': return typeof value.symbol === 'string' && typeof value.interval === 'string' && Array.isArray(value.points) && value.points.every(isCandle)
    case 'map': return isJson(value.spec)
    case 'document': return typeof value.mime === 'string' && optionalString(value.text) && optionalSafeUrl(value.url)
    case 'file': return typeof value.filename === 'string' && !value.filename.includes('..') && typeof value.mime === 'string' && optionalString(value.text) && optionalSafeUrl(value.url)
    case 'app': return typeof value.entry === 'string' && !value.entry.includes('..') && isRecordOfStrings(value.files)
    case 'ui': return isJson(value.schema)
    default: return optionalString(value.mime) && isJson(value.data)
  }
}

function isBuiltinBlock(block: ArtifactBlock): block is BuiltinArtifactBlock {
  return block.type === 'markdown' || block.type === 'code' || block.type === 'image' || block.type === 'table'
    || block.type === 'chart' || block.type === 'candles' || block.type === 'map' || block.type === 'document'
    || block.type === 'file' || block.type === 'app' || block.type === 'ui'
}

function isCandle(value: unknown): value is Candle {
  if (!isRecord(value)) return false
  const time = numberValue(value.time)
  const open = numberValue(value.open)
  const high = numberValue(value.high)
  const low = numberValue(value.low)
  const close = numberValue(value.close)
  if (time === undefined || open === undefined || high === undefined || low === undefined || close === undefined) return false
  return high >= Math.max(open, close) && low <= Math.min(open, close)
}
function isJson(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJson)
  return isRecord(value) && Object.entries(value).every(([key, child]) => !FORBIDDEN_KEY.test(key) && isJson(child))
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isRecordOfStrings(value: unknown): value is Record<string, string> { return isRecord(value) && Object.entries(value).every(([key, child]) => !key.includes('..') && typeof child === 'string') }
function isString(value: unknown): value is string { return typeof value === 'string' }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function optionalString(value: unknown): value is string | undefined { return value === undefined || typeof value === 'string' }
function optionalFinite(value: unknown): value is number | undefined { return value === undefined || (typeof value === 'number' && Number.isFinite(value)) }
function optionalSafeUrl(value: unknown): value is string | undefined { return value === undefined || (typeof value === 'string' && SAFE_URL.test(value)) }

export function renderArtifactBlock(block: ArtifactBlock): ReactNode {
  const customRenderer = renderers.get(block.type)
  if (customRenderer !== undefined) return customRenderer(block)
  if (!isBuiltinBlock(block)) return createElement('section', { 'data-artifact-block': block.type }, createElement('pre', null, JSON.stringify(block.data, null, 2)))
  switch (block.type) {
    case 'markdown': return createElement('p', { 'data-artifact-block': 'markdown' }, block.text)
    case 'code': return createElement('section', { 'data-artifact-block': 'code' }, createElement('strong', null, block.filename ?? block.language), createElement('pre', null, block.text))
    case 'image': return createElement('figure', { 'data-artifact-block': 'image' }, createElement('img', { src: block.src, alt: block.alt, width: block.width, height: block.height, loading: 'lazy', style: { maxWidth: '100%', height: 'auto' } }))
    case 'table': return renderTable(block)
    case 'chart': return renderChart(block.spec)
    case 'candles': return renderCandles(block)
    case 'map': return createElement('section', { 'data-artifact-block': 'map' }, createElement('strong', null, 'Mapa'), createElement('pre', null, JSON.stringify(block.spec, null, 2)))
    case 'document': return renderResource('document', block.mime, block.text, block.url)
    case 'file': return renderResource('file', block.mime, block.text, block.url, block.filename)
    case 'app': return createElement('section', { 'data-artifact-block': 'app' }, createElement('strong', null, block.entry), createElement('iframe', { title: block.entry, sandbox: '', srcDoc: block.files[block.entry] ?? '', style: { width: '100%', minHeight: 240, border: '1px solid #e2e8f0', borderRadius: 10 } }))
    case 'ui': return createElement('section', { 'data-artifact-block': 'ui' }, createElement('pre', null, JSON.stringify(block.schema, null, 2)))
    default: return null
  }
}

function renderTable(block: Extract<ArtifactBlock, { type: 'table' }>): ReactNode {
  const head = createElement('thead', null, createElement('tr', null, block.columns.map(column => createElement('th', { key: column, scope: 'col' }, column))))
  const body = createElement('tbody', null, block.rows.map((row, index) => createElement('tr', { key: index }, row.map((cell, cellIndex) => createElement('td', { key: cellIndex }, cell)))))
  return createElement('table', { 'data-artifact-block': 'table' }, head, body)
}

function renderResource(type: string, mime: string, text?: string, url?: string, filename?: string): ReactNode {
  return createElement('section', { 'data-artifact-block': type }, createElement('strong', null, filename ?? mime), text === undefined && url !== undefined ? createElement('a', { href: url, target: '_blank', rel: 'noreferrer' }, 'Abrir') : createElement('pre', null, text ?? 'Sin preview'))
}
function renderChart(spec: JsonValue): ReactNode {
  const values = isRecord(spec) && Array.isArray(spec.data) ? spec.data.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : []
  if (values.length < 2) return createElement('section', { 'data-artifact-block': 'chart' }, createElement('strong', null, 'Gráfico'), createElement('pre', null, JSON.stringify(spec, null, 2)))
  return createElement('svg', { 'data-artifact-block': 'chart', viewBox: '0 0 400 140', role: 'img', 'aria-label': 'Gráfico de datos', style: { width: '100%', minHeight: 140 } }, createElement('polyline', { fill: 'none', stroke: '#356ae6', strokeWidth: 3, points: values.map((value, index) => `${index * 400 / (values.length - 1)},${130 - value * 110 / Math.max(...values, 1)}`).join(' ') }))
}
function renderCandles(block: Extract<ArtifactBlock, { type: 'candles' }>): ReactNode {
  const max = Math.max(...block.points.map(point => point.high), 1)
  const min = Math.min(...block.points.map(point => point.low), 0)
  const range = Math.max(max - min, 1)
  const candleNodes = block.points.map((point, index) => {
    const x = index * 24 + 12
    const y = (value: number) => 145 - (value - min) * 125 / range
    const up = point.close >= point.open
    const color = up ? '#18864b' : '#d04444'
    return createElement('g', { key: point.time },
      createElement('line', { x1: x, x2: x, y1: y(point.high), y2: y(point.low), stroke: color, strokeWidth: 2 }),
      createElement('rect', { x: x - 5, y: y(Math.max(point.open, point.close)), width: 10, height: Math.max(y(Math.min(point.open, point.close)) - y(Math.max(point.open, point.close)), 2), fill: color }),
    )
  })
  const svg = createElement('svg', { viewBox: `0 0 ${Math.max(block.points.length * 24, 240)} 160`, role: 'img', 'aria-label': `Velas de ${block.symbol}`, style: { width: '100%', minHeight: 160 } }, candleNodes)
  return createElement('section', { 'data-artifact-block': 'candles' }, createElement('strong', null, `${block.symbol} · ${block.interval}`), svg)
}
