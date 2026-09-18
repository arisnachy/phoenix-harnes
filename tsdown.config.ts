import { globSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'
import { decoratorLoweringPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

interface WorkspaceRuntimeManifest {
  readonly dependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
  readonly optionalDependencies?: Record<string, string>
}

const REPOSITORY_ROOT = fileURLToPath(new URL('.', import.meta.url))
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
 * Fast-path only decisions that exactly match tsdown's default Host semantics:
 * Node builtins and exact declared runtime dependencies are external.
 * Subpaths, aliases, virtual modules, and imports from bundled node_modules
 * remain undecided so tsdown:deps can preserve its normal resolution behavior.
 */
function declaredHostExternal(
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

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project. Host Typert contracts are generated beforehand by the
 * explicit incremental build:typert phase, outside Rolldown. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    workspace: ['vendor/*', 'packages/*/*', 'apps/cli'],
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // Size reporting is intentionally off in normal workspace builds. It does
    // not affect emitted artifacts and was itself a dominant PLUGIN_TIMINGS
    // hotspot on slower Windows hosts.
    report: false,
    ...(client ? {} : {
      // Pre-externalize only decisions that are provably identical to
      // tsdown:deps defaults. This keeps ambiguous imports on tsdown's path
      // while avoiding its resolver for the common Host case.
      inputOptions: { external: declaredHostExternal },
    }),
    plugins: client ? [] : [decoratorLoweringPlugin()],
  }
})
