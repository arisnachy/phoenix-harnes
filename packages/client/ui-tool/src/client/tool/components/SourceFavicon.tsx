import { useState, type ReactNode } from 'react'
import type { ToolCallBlock } from '@phoenix-ai/dsh-client-runtime/client'

/** A source icon requires a real URL or a tool that actually invokes the named service. */
const SERVICES: readonly (readonly [RegExp, string])[] = [
  [/^(?:mcp__)?github(?:__|_|$)/i, 'https://github.com'],
  [/^(?:mcp__)?google_drive(?:__|_|$)/i, 'https://drive.google.com'],
  [/^(?:mcp__)?google_calendar(?:__|_|$)/i, 'https://calendar.google.com'],
  [/^(?:mcp__)?gmail(?:__|_|$)/i, 'https://mail.google.com'],
  [/^(?:mcp__)?notion(?:__|_|$)/i, 'https://www.notion.so'],
  [/^(?:mcp__)?figma(?:__|_|$)/i, 'https://www.figma.com'],
  [/^(?:mcp__)?canva(?:__|_|$)/i, 'https://www.canva.com'],
  [/^(?:mcp__)?vercel(?:__|_|$)/i, 'https://vercel.com'],
  [/^(?:mcp__)?supabase(?:__|_|$)/i, 'https://supabase.com'],
  [/^(?:mcp__)?binance(?:__|_|$)/i, 'https://www.binance.com'],
]
const URL_FIELDS = new Set(['url', 'urls', 'uri', 'href', 'link', 'links', 'website',
  'source', 'sources', 'sourceUrl', 'source_url', 'pageUrl', 'page_url', 'webUrl',
  'web_url', 'endpoint', 'endpoints'])

/** Restrict icon loading to public HTTPS origins; discard paths, secrets and queries. */
export function faviconOrigin(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined
    if (!/^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(host)) return undefined
    if (/\.(?:local|internal|localhost)$/.test(host)) return undefined
    return url.origin
  } catch { return undefined }
}

/** Inspect explicit URL fields only: search query text is not proof of a visited website. */
function argumentOrigin(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.length > 24000) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return undefined }
  const queue: Array<{ value: unknown; trusted: boolean; depth: number }> = [
    { value: parsed, trusted: false, depth: 0 },
  ]
  let examined = 0
  while (queue.length > 0 && examined++ < 80) {
    const next = queue.shift()
    if (next === undefined || next.depth > 5) continue
    if (typeof next.value === 'string') {
      if (next.trusted) {
        const source = faviconOrigin(next.value)
        if (source !== undefined) return source
      }
    } else if (Array.isArray(next.value)) {
      for (const value of next.value.slice(0, 12)) queue.push({ value, trusted: next.trusted, depth: next.depth + 1 })
    } else if (next.value !== null && typeof next.value === 'object') {
      for (const [key, value] of Object.entries(next.value)) {
        if (URL_FIELDS.has(key) || (next.trusted && (key === 'url' || key === 'href'))) {
          queue.push({ value, trusted: true, depth: next.depth + 1 })
        }
      }
    }
  }
  return undefined
}

function observedOrigin(block: ToolCallBlock): string | undefined {
  if (!('kind' in block) || block.resultView?.card !== 'web') return undefined
  const result = block.resultView
  if (result.kind === 'fetch') return faviconOrigin(result.url)
  if (result.kind === 'search') {
    for (const source of result.sources) {
      const origin = faviconOrigin(source.url)
      if (origin !== undefined) return origin
    }
  }
  return undefined
}

/** Actual provider URLs, settled search sources and nested Code tool calls. */
export function sourceFaviconOrigin(block: ToolCallBlock): string | undefined {
  const queue: ToolCallBlock[] = [block]
  const visited = new Set<ToolCallBlock>()
  while (queue.length > 0 && visited.size < 128) {
    const current = queue.shift()
    if (current === undefined || visited.has(current)) continue
    visited.add(current)
    const observed = observedOrigin(current)
    if (observed !== undefined) return observed
    const call = 'kind' in current ? current.call : current
    const argSource = argumentOrigin(call?.argsRaw)
    if (argSource !== undefined) return argSource
    const knownService = SERVICES.find(([matcher]) => matcher.test(call?.name ?? ''))
    if (knownService !== undefined) return knownService[1]
    queue.push(...(current.subCalls ?? []).slice(0, 32))
  }
  return undefined
}

function LoadedFavicon({ origin, fallback }: { origin: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(0)
  if (failed >= 2) return <>{fallback}</>
  const domain = new URL(origin).hostname
  const src = failed === 0 ? origin + '/favicon.ico'
    : 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=32'
  return <img src={src} width={14} height={14} alt="" aria-hidden="true" draggable={false}
    data-source-favicon={domain}
    style={{ display: 'block', width: 14, height: 14, objectFit: 'contain', borderRadius: 2 }}
    onError={() => { setFailed(value => value + 1) }} />
}

/** 14px inside the existing leading slot; original icon remains the safe fallback. */
export function SourceFavicon({ block, fallback }: { block: ToolCallBlock; fallback: ReactNode }) {
  const origin = sourceFaviconOrigin(block)
  return origin === undefined ? <>{fallback}</> : <LoadedFavicon key={origin} origin={origin} fallback={fallback} />
}
