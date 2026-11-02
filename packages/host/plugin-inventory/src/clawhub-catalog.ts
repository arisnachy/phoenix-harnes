/**
 * Public ClawHub discovery in PHOENIX's existing plugin/skills catalog.
 * Catalog metadata is not an execution authority and never loads packages.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ClawHubCatalogRequest, ClawHubCatalogSnapshot, ClawHubCatalogItem } from './types.ts'

const BASE = 'https://clawhub.ai'
const MAX = 20
const catalogCache = new Map<string, { expires: number; value: ClawHubCatalogSnapshot }>()
const CACHE_MS = 60_000
const NAME = /^[\p{L}\p{N} ._/@-]{0,80}$/u

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}
function str(v: unknown): string { return typeof v === 'string' ? v : '' }
function items(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  const root = obj(v)
  for (const key of ['items', 'results', 'skills', 'packages', 'data']) {
    if (Array.isArray(root[key])) return root[key] as unknown[]
    const nested = obj(root[key])
    if (Array.isArray(nested.items)) return nested.items as unknown[]
  }
  return []
}
export function normalizeClawHubCatalog(
  payload: unknown,
  request: ClawHubCatalogRequest,
): ClawHubCatalogItem[] {
  const base = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const output: ClawHubCatalogItem[] = []
  const seen = new Set<string>()
  for (const entry of items(payload)) {
    const raw = obj(entry)
    const skill = obj(raw.skill)
    const pkg = obj(raw.package)
    const latest = obj(raw.latestVersion)
    const owner = obj(raw.owner)
    const ownerHandle = (str(owner.handle) || str(raw.ownerHandle)).replace(/^@/u, '')
    const slug = str(raw.slug) || str(skill.slug) || str(pkg.slug)
    // Skill API entries can carry human-readable "name" with spaces. Prefer
    // the canonical package identity or owner/slug before display strings.
    const id = str(raw.packageName) || str(pkg.name)
      || (ownerHandle && slug ? `@${ownerHandle}/${slug}` : slug || str(raw.name))
    if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu.test(id)) continue
    const canonical = id.toLowerCase()
    if (seen.has(canonical)) continue
    const official = raw.isOfficial === true || pkg.isOfficial === true || raw.channel === 'official'
      || raw.official === true
    if (request.officialOnly === true && !official) continue
    seen.add(canonical)
    const skillName = slug || id.split('/').at(-1) || id
    output.push({
      name: id,
      displayName: (str(raw.displayName) || str(raw.title) || str(skill.displayName) || skillName).slice(0, 100),
      description: (str(raw.summary) || str(raw.description) || str(skill.summary) || str(pkg.summary)).slice(0, 400),
      version: (str(raw.version) || str(latest.version) || str(raw.latestVersion) || '—').slice(0, 50),
      official,
      family: request.family,
      installed: request.family === 'skill' && existsSync(join(base, 'skills', skillName, 'SKILL.md')),
    })
    if (output.length >= MAX) break
  }
  return output
}

/** Live ClawHub catalog; HTTP errors are explicit, not fabricated cards. */
export async function readClawHubCatalog(request: ClawHubCatalogRequest): Promise<ClawHubCatalogSnapshot> {
  if (!['skill', 'code-plugin', 'bundle-plugin'].includes(request.family)) throw new Error('Invalid ClawHub family')
  const query = request.query?.trim() ?? ''
  if (!NAME.test(query)) throw new Error('Invalid ClawHub catalog search')
  const limit = Math.max(1, Math.min(MAX, Math.trunc(request.limit ?? 12)))
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  let pathname: string
  if (request.family === 'skill') {
    if (query) { pathname = '/api/v1/search'; params.set('q', query) }
    else { pathname = '/api/v1/skills'; params.set('sort', 'downloads') }
  } else {
    pathname = query ? '/api/v1/packages/search' : '/api/v1/packages'
    params.set('family', request.family)
    if (query) params.set('q', query)
    if (request.officialOnly) params.set('isOfficial', 'true')
  }
  const url = BASE + pathname + '?' + params.toString()
  const cached = catalogCache.get(url)
  if (cached !== undefined && cached.expires > Date.now()) return cached.value
  let response: Response
  try {
    response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new Error('ClawHub catalog network unavailable')
  }
  if (response.status === 429) throw new Error('ClawHub catalog is rate-limited; retry later')
  if (!response.ok) throw new Error(`ClawHub catalog temporarily unavailable (HTTP ${response.status})`)
  const body: unknown = await response.json().catch(() => undefined)
  if (body === undefined) throw new Error('ClawHub catalog returned non-JSON data')
  const value: ClawHubCatalogSnapshot = {
    source: 'clawhub', family: request.family,
    items: normalizeClawHubCatalog(body, request).slice(0, limit),
  }
  // The public registry rate-limits anonymous readers: avoid re-querying the
  // same browse page during chat/Settings remounts.
  if (catalogCache.size > 60) catalogCache.clear()
  catalogCache.set(url, { expires: Date.now() + CACHE_MS, value })
  return value
}
