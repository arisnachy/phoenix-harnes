/** Deterministic, bounded projection of durable files into model-readable text. */

import { unzipSync } from 'fflate'
import type { FileAttachmentRef } from './types.ts'

/** The recognized projection kind, useful for diagnostics and UI previews. */
export type FileContentFormat = 'text' | 'pdf' | 'office-open-xml' | 'printable-binary'

/** Bounded content extracted from one durable file. */
export interface FileContentProjection {
  /** Extracted text, never longer than the requested character bound. */
  readonly text: string
  /** Format-specific extraction path used for this projection. */
  readonly format: FileContentFormat
  /** Whether the source or extracted text exceeded the requested bound. */
  readonly truncated: boolean
}

const TEXT_MEDIA_TYPES = /^(?:text\/|application\/(?:json|javascript|xml|yaml|x-yaml|toml|csv)|image\/svg\+xml$)/iu
const TEXT_NAMES = /\.(?:c|cc|cpp|css|csv|go|html?|java|js|json|md|py|rs|sql|svg|toml|ts|tsx|txt|xml|yaml|yml)$/iu
const OFFICE_NAMES = /\.(?:docx|pptx|xlsx)$/iu
const OFFICE_MEDIA_TYPES = /^application\/vnd\.openxmlformats-officedocument\./iu
const PDF_MEDIA_TYPE = 'application/pdf'
const PDF_NAME = /\.pdf$/iu
const MAX_PRINTABLE_RUN = 16

/**
 * Decide whether a file is expected to contain UTF-8 text.
 * @param ref - stored attachment reference metadata.
 * @returns whether the reference identifies a text-like file.
 */
export function isTextFile(ref: Pick<FileAttachmentRef, 'mediaType' | 'name'>): boolean {
  return TEXT_MEDIA_TYPES.test(ref.mediaType) || TEXT_NAMES.test(ref.name ?? '')
}

/**
 * Project one durable file into bounded model-readable text when supported.
 * @param ref - stored attachment reference metadata.
 * @param data - attachment bytes.
 * @param maxBytes - maximum source bytes to inspect and report.
 * @returns a bounded projection, or undefined when no safe text projection exists.
 */
export function projectFileContent(
  ref: Pick<FileAttachmentRef, 'mediaType' | 'name'>,
  data: Uint8Array,
  maxBytes: number,
): FileContentProjection | undefined {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError('file content projection requires a positive byte limit')
  }
  if (isTextFile(ref)) {
    return textProjection(data, maxBytes)
  }
  if (ref.mediaType.toLowerCase() === PDF_MEDIA_TYPE || PDF_NAME.test(ref.name ?? '')) {
    const text = pdfText(data)
    if (text.length > 0) return boundedProjection(text, 'pdf', maxBytes, data.byteLength > maxBytes)
  }
  if (OFFICE_MEDIA_TYPES.test(ref.mediaType) || OFFICE_NAMES.test(ref.name ?? '')) {
    const text = officeOpenXmlText(data, ref.name)
    if (text.length > 0) return boundedProjection(text, 'office-open-xml', maxBytes, data.byteLength > maxBytes)
  }
  const printable = printableText(data)
  if (printable.length > 0) return boundedProjection(printable, 'printable-binary', maxBytes, data.byteLength > maxBytes)
  return undefined
}

function textProjection(data: Uint8Array, maxBytes: number): FileContentProjection {
  const bytes = data.subarray(0, maxBytes)
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  return {
    text,
    format: 'text',
    truncated: data.byteLength > maxBytes,
  }
}

function boundedProjection(
  text: string,
  format: FileContentFormat,
  maxBytes: number,
  sourceTruncated: boolean,
): FileContentProjection {
  return {
    text: text.slice(0, maxBytes),
    format,
    truncated: sourceTruncated || text.length > maxBytes,
  }
}

function officeOpenXmlText(data: Uint8Array, name: string | undefined): string {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data)
  } catch {
    return ''
  }
  const paths = Object.keys(entries)
    .filter(path => officeXmlPath(path, name))
    .sort()
  return paths.map(path => xmlText(entries[path] as Uint8Array)).filter(Boolean).join(' ')
}

function officeXmlPath(path: string, name: string | undefined): boolean {
  if (name?.toLowerCase().endsWith('.docx')) return path === 'word/document.xml'
  if (name?.toLowerCase().endsWith('.pptx')) return /^ppt\/slides\/slide\d+\.xml$/iu.test(path)
  if (name?.toLowerCase().endsWith('.xlsx')) {
    return path === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/iu.test(path)
  }
  return /^(?:word\/document\.xml|ppt\/slides\/slide\d+\.xml|xl\/(?:sharedStrings|worksheets\/sheet\d+)\.xml)$/iu.test(path)
}

function xmlText(data: Uint8Array): string {
  const source = new TextDecoder('utf-8', { fatal: false }).decode(data)
  return decodeXmlEntities(source
    .replace(/<[^>]*>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim())
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_match, entity: string) => {
    if (entity.toLowerCase() === 'amp') return '&'
    if (entity.toLowerCase() === 'lt') return '<'
    if (entity.toLowerCase() === 'gt') return '>'
    if (entity.toLowerCase() === 'quot') return '"'
    if (entity.toLowerCase() === 'apos') return "'"
    const code = entity.toLowerCase().startsWith('#x')
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10)
    return Number.isSafeInteger(code) ? String.fromCodePoint(code) : ''
  })
}

function pdfText(data: Uint8Array): string {
  const sourceParts: string[] = []
  for (let offset = 0; offset < data.byteLength; offset += 8192) {
    sourceParts.push(String.fromCharCode(...data.subarray(offset, offset + 8192)))
  }
  const source = sourceParts.join('')
  const chunks: string[] = []
  for (const match of source.matchAll(/BT([\s\S]*?)ET/gu)) {
    const segment = match[1] as string
    const values: string[] = []
    for (let index = 0; index < segment.length; index += 1) {
      const character = segment[index]
      if (character === '(') {
        const parsed = pdfLiteral(segment, index)
        if (parsed === undefined) continue
        values.push(parsed.text)
        index = parsed.end
      } else if (character === '<' && segment[index + 1] !== '<') {
        const end = segment.indexOf('>', index + 1)
        if (end < 0) continue
        values.push(pdfHex(segment.slice(index + 1, end)))
        index = end
      }
    }
    chunks.push(...values)
  }
  return chunks.join(' ').replace(/\s+/gu, ' ').trim()
}

function pdfLiteral(source: string, start: number): { text: string; end: number } | undefined {
  let depth = 0
  let value = ''
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (character === undefined) break
    if (character === '\\') {
      const next = source[index + 1]
      if (next === undefined) return undefined
      const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }
      value += escapes[next] ?? next
      index += 1
      continue
    }
    if (character === '(') {
      depth += 1
      if (depth > 1) value += character
      continue
    }
    if (character === ')') {
      depth -= 1
      if (depth === 0) return { text: value, end: index }
      value += character
      continue
    }
    value += character
  }
  return undefined
}

function pdfHex(value: string): string {
  const compact = value.replace(/\s+/gu, '')
  const even = compact.length % 2 === 0 ? compact : `${compact}0`
  let result = ''
  for (let index = 0; index < even.length; index += 2) {
    const code = Number.parseInt(even.slice(index, index + 2), 16)
    if (Number.isFinite(code)) result += String.fromCharCode(code)
  }
  return result
}

function printableText(data: Uint8Array): string {
  const chunks: string[] = []
  let current = ''
  const flush = (): void => {
    if (current.length >= MAX_PRINTABLE_RUN) chunks.push(current)
    current = ''
  }
  for (const byte of data) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
      current += String.fromCharCode(byte)
    } else {
      flush()
    }
  }
  flush()
  return chunks.join('\n').replace(/\s+/gu, ' ').trim()
}
