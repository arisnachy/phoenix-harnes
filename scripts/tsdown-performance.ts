import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface PackageManifest {
  readonly name?: string
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

interface InputOptionsLike {
  readonly cwd?: string
  readonly external?: unknown
  readonly plugins?: unknown
}

export interface PhoenixTsdownOptimization {
  /**
   * Additional native external rule owned by the caller (for example the
   * client module table or the static-linked bare-module matcher).
   */
  readonly external?: unknown
  /**
   * Whether package.json production/peer/optional dependencies should stay
   * external. Node libraries use this; self-contained browser bundles do not.
   * @default true
   */
  readonly externalizeProductionDeps?: boolean
}

const manifestCache = new Map<string, PackageManifest>()

/**
 * app-boot intentionally embeds Include while keeping its other production
 * peers external. This is the only workspace alwaysBundle exception.
 */
const FORCED_BUNDLES = new Map<string, ReadonlySet<string>>([
  ['@phoenix-ai/dsh-app-boot', new Set(['@phoenix-ai/cordis-plugin-include'])],
])

function escapeSpecifier(value: string): string {
  return value.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')
}

function packageManifest(cwd: string): PackageManifest {
  const cached = manifestCache.get(cwd)
  if (cached !== undefined) return cached
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as PackageManifest
  manifestCache.set(cwd, manifest)
  return manifest
}

function productionExternalPattern(cwd: string): RegExp | undefined {
  const manifest = packageManifest(cwd)
  const forced = manifest.name === undefined ? undefined : FORCED_BUNDLES.get(manifest.name)
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])
  for (const name of forced ?? []) names.delete(name)
  if (names.size === 0) return undefined
  return new RegExp('^(?:' + [...names].sort().map(escapeSpecifier).join('|') + ')(?:/|$)')
}

function flattenExternal(value: unknown): unknown[] {
  if (value === undefined || value === null || value === false) return []
  return Array.isArray(value) ? value.flatMap(flattenExternal) : [value]
}

function mergeExternal(...values: unknown[]): unknown {
  const items = values.flatMap(flattenExternal)
  if (items.length === 0) return undefined
  if (items.length === 1) return items[0]
  return items
}

function stripTsdownHotPlugins(value: unknown): unknown {
  if (!Array.isArray(value)) {
    if (
      value !== null
      && typeof value === 'object'
      && 'name' in value
      && ((value as { name?: unknown }).name === 'tsdown:deps'
        || (value as { name?: unknown }).name === 'tsdown:report')
    ) return undefined
    return value
  }

  const result: unknown[] = []
  for (const item of value) {
    const cleaned = stripTsdownHotPlugins(item)
    if (cleaned === undefined || cleaned === null || cleaned === false) continue
    if (Array.isArray(cleaned)) result.push(...cleaned)
    else result.push(cleaned)
  }
  return result
}

/**
 * Replace tsdown's dependency/report hot plugins with native Rolldown options.
 *
 * tsdown 0.22.2 resolves every bare import inside tsdown:deps before deciding
 * whether a production dependency is external, then scans bundled modules in
 * generateBundle. Phoenix already owns these dependency contracts, so doing
 * the same work again is pure overhead.
 */
export function optimizePhoenixTsdownInput<T extends InputOptionsLike>(
  options: T,
  optimization: PhoenixTsdownOptimization = {},
): T {
  const externalizeProductionDeps = optimization.externalizeProductionDeps ?? true
  const production = externalizeProductionDeps && options.cwd !== undefined
    ? productionExternalPattern(options.cwd)
    : undefined
  const external = mergeExternal(options.external, production, optimization.external)
  return {
    ...options,
    ...(external === undefined ? {} : { external }),
    plugins: stripTsdownHotPlugins(options.plugins),
  }
}
