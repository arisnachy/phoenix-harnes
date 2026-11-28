import type { LocalLibraryRequest, LocalLibraryEntry, LocalLibrarySnapshot } from '../types.ts'
import { validOllamaTag } from './catalog.js'

const familyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}(?:\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,79})?$/u
const repoPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u

/** Parse only canonical public links; never evaluate remote HTML.
 * @param html - Official public directory markup.
 * @param family - Exact family for variant listing.
 * @returns Deduplicated local-family or local-variant records.
 */
export function parseOllamaLibrary(html: string, family?: string): LocalLibraryEntry[] {
  const result = new Map<string, LocalLibraryEntry>()
  for (const match of html.matchAll(/href\s*=\s*["'](?:https:\/\/ollama\.com)?\/(?:library|models)\/([^"'?#\s<>]+)["']/giu)) {
    const raw = match[1]
    if (raw === undefined) continue
    const tag = raw.replace(/%3a/giu, ':')
    if (family === undefined) {
      if (!familyPattern.test(tag) || tag.endsWith('/tags')) continue
      result.set(tag, { name: tag, family: tag, url: 'https://ollama.com/library/' + tag })
    } else {
      if (!tag.startsWith(family + ':') || !validOllamaTag(tag) || /(?:cloud|mlx|remote)/iu.test(tag.slice(family.length + 1))) continue
      result.set(tag, { name: tag, url: 'https://ollama.com/library/' + tag, installId: 'ollama:' + tag })
    }
    if (result.size >= 80) break
  }
  return [...result.values()]
}

/** Normalize public GGUF repositories into explicit Ollama import candidates.
 * @param value - Untrusted Hub API result.
 * @returns Public, non-gated repositories with valid names.
 */
export function parseHubLibrary(value: unknown): LocalLibraryEntry[] {
  if (!Array.isArray(value)) return []
  const entries: LocalLibraryEntry[] = []
  for (const row of value.slice(0, 40)) {
    if (typeof row !== 'object' || row === null || row.private !== false || (row.gated !== false && row.gated !== undefined)) continue
    const id: unknown = row.id ?? row.modelId
    if (typeof id !== 'string' || !repoPattern.test(id)) continue
    const tag = 'hf.co/' + id
    if (!validOllamaTag(tag)) continue
    if (!Array.isArray(row.tags) || !row.tags.includes('gguf')) continue
    entries.push({ name: id, url: 'https://huggingface.co/' + id, installId: 'ollama:' + tag,
      ...(typeof row.downloads === 'number' && Number.isSafeInteger(row.downloads) && row.downloads >= 0 ? { downloads: row.downloads } : {}),
      ...(typeof row.lastModified === 'string' && Number.isFinite(Date.parse(row.lastModified)) ? { updatedAt: row.lastModified } : {}) })
  }
  return entries
}

/** Fetch only fixed official public origins; no redirects, tokens or local data.
 * @param request - Explicit public catalog query.
 * @param fetcher - Injectable HTTP transport.
 * @returns Current directory metadata, not a compatibility certification.
 */
export async function searchLocalLibrary(request: LocalLibraryRequest, fetcher = fetch): Promise<LocalLibrarySnapshot> {
  if (typeof request.query !== 'string' || request.query.length > 100) throw new Error('Invalid model query')
  if (request.source !== 'ollama' && request.source !== 'huggingface') throw new Error('Invalid model source')
  if (request.family !== undefined && (request.source !== 'ollama' || !familyPattern.test(request.family))) throw new Error('Invalid Ollama family')
  const query = request.query.trim()
  const url = request.source === 'huggingface' ? new URL('https://huggingface.co/api/models')
    : new URL(request.family === undefined ? 'https://ollama.com/search' : 'https://ollama.com/library/' + request.family + '/tags')
  if (request.source === 'huggingface') {
    url.search = new URLSearchParams({ search: query, filter: 'gguf', pipeline_tag: 'text-generation', limit: '30', full: 'true', sort: request.sort === 'recent' ? 'lastModified' : 'downloads', direction: '-1' }).toString()
  } else if (request.family === undefined) url.searchParams.set('q', query)
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: { accept: request.source === 'huggingface' ? 'application/json' : 'text/html' } })
  if (!response.ok || response.body === null) throw new Error('Model directory unavailable: HTTP ' + response.status)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > 4_000_000) throw new Error('Model directory response too large')
      body += decoder.decode(next.value, { stream: true })
    }
    body += decoder.decode()
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  const entries = request.source === 'huggingface' ? parseHubLibrary(JSON.parse(body)) : parseOllamaLibrary(body, request.family)
  return { entries, fetchedAt: new Date().toISOString() }
}
