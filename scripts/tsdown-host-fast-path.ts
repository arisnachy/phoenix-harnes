import { globSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'

interface WorkspaceRuntimeManifest {
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))
const productionDepsByRoot = new Map<string, ReadonlySet<string>>()

for (const manifestPath of globSync([
  'packages/*/*/package.json',
  'vendor/*/package.json',
  'apps/cli/package.json',
], { cwd: REPOSITORY_ROOT })) {
  const absoluteManifest = resolve(REPOSITORY_ROOT, manifestPath)
  const manifest = JSON.parse(readFileSync(absoluteManifest, 'utf8')) as WorkspaceRuntimeManifest
  productionDepsByRoot.set(dirname(absoluteManifest), new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]))
}

function exactPackageSpecifier(id: string): string | undefined {
  if (id.startsWith('@')) {
    const parts = id.split('/')
    return parts.length === 2 ? id : undefined
  }
  return id.includes('/') ? undefined : id
}

function workspaceRootForImporter(importer: string): string | undefined {
  const rel = relative(REPOSITORY_ROOT, importer)
  if (rel.startsWith('..') || rel === '') return undefined
  const parts = rel.split(sep)
  if (parts[0] === 'packages' && parts.length >= 4) {
    return resolve(REPOSITORY_ROOT, parts[0], parts[1]!, parts[2]!)
  }
  if (parts[0] === 'vendor' && parts.length >= 3) {
    return resolve(REPOSITORY_ROOT, parts[0], parts[1]!)
  }
  if (parts[0] === 'apps' && parts[1] === 'cli' && parts.length >= 3) {
    return resolve(REPOSITORY_ROOT, 'apps', 'cli')
  }
  return undefined
}

/**
 * Fast-path only decisions that exactly match tsdown's default Host semantics.
 */
export function declaredHostExternal(
  id: string,
  importer: string | undefined,
): boolean | undefined {
  if (isBuiltin(id)) return true
  if (importer === undefined) return undefined
  const packageName = exactPackageSpecifier(id)
  if (packageName === undefined) return undefined
  const packageRoot = workspaceRootForImporter(importer)
  if (packageRoot === undefined) return undefined
  return productionDepsByRoot.get(packageRoot)?.has(packageName) === true
    ? true
    : undefined
}

export function hostPerformanceOptions(client: boolean): Pick<UserConfig, 'report' | 'inputOptions'> {
  return {
    report: false,
    ...(client ? {} : { inputOptions: { external: declaredHostExternal } }),
  }
}
