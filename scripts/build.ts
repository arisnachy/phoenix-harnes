/** Run repository builds and bind client artifacts to their public environment. */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  CLIENT_BUILD_RECORD_PATH,
  clientBuildProcessEnvironment,
  repositoryCommitHash,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'

/** Build scope selected by callers such as the stable updater. */
type BuildScope = 'full' | 'client'

/** One generated Host Remote contract that must exist before client typecheck can resolve Remote exports. */
const HOST_REMOTE_SENTINEL = resolve(
  import.meta.dirname,
  '..',
  'packages',
  'host',
  'plugin-inventory',
  'lib',
  'typert.remote-client.d.ts',
)

const PROFILE_RUNTIME_PACKAGE_DIRS = [
  'packages/credentials/authorization',
  'packages/mcp/mcp-client',
  'packages/mcp/mcp-registry',
  'packages/credentials/tool-google-workspace',
  'packages/host/plugin-inventory',
] as const

function verifyProfileRuntimeArtifacts(root: string): void {
  const missing: string[] = []
  for (const relativeDir of PROFILE_RUNTIME_PACKAGE_DIRS) {
    const manifestPath = resolve(root, relativeDir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown; main?: unknown }
    const name = typeof manifest.name === 'string' ? manifest.name : relativeDir
    const main = typeof manifest.main === 'string' ? manifest.main.trim() : ''
    if (main.length === 0 || !existsSync(resolve(root, relativeDir, main))) {
      missing.push(`${name}: ${main.length === 0 ? 'package.json has no main' : main}`)
    }
  }
  if (missing.length > 0) {
    throw new Error(
      'build: profile runtime is incomplete; required compiled artifact(s) are missing:\n'
      + missing.map(value => `  - ${value}`).join('\n'),
    )
  }
}

/** Resolve the repository-pinned pnpm package-manager specifier. */
function projectPnpmSpecifier(root: string): string {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { packageManager?: unknown }
  const configured = typeof manifest.packageManager === 'string' ? manifest.packageManager.trim() : ''
  if (!/^pnpm@[^\s]+$/u.test(configured)) {
    throw new Error(`build: package.json must pin packageManager to pnpm@<version>; got ${JSON.stringify(manifest.packageManager)}`)
  }
  return configured
}

/**
 * Resolve the exact project-pinned pnpm for every nested build command.
 *
 * Do not trust npm_execpath here. When the updater starts pnpm@11.7.0 through
 * Corepack, some Windows Corepack installations leak their own cached
 * pnpm@12.x entrypoint through npm_execpath. Reusing that entrypoint makes
 * pnpm reject this repository's 11.7.0 packageManager pin mid-build.
 */
export function buildPnpmInvocation(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): { command: string; args: string[] } {
  const root = resolve(import.meta.dirname, '..')
  const pnpmSpecifier = projectPnpmSpecifier(root)
  if (process.platform === 'win32') {
    return {
      command: environment.ComSpec ?? process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'corepack.cmd', pnpmSpecifier, ...args],
    }
  }
  return { command: 'corepack', args: [pnpmSpecifier, ...args] }
}

/** Keep the user's real Codex home while isolating only build-time SQLite state. */
export function isolateBuildCodexHome(
  root: string,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const configuredPhoenixSqlite = environment.PHOENIX_CODEX_SQLITE_HOME?.trim()
  const sqliteHome = configuredPhoenixSqlite && configuredPhoenixSqlite.length > 0
    ? resolve(configuredPhoenixSqlite, 'build')
    : resolve(root, '.cache', 'phoenix', 'build-codex-sqlite')
  mkdirSync(sqliteHome, { recursive: true })
  return {
    ...environment,
    CODEX_SQLITE_HOME: sqliteHome,
    PHOENIX_BUILD_PROCESS: '1',
  }
}

/** Run one package script through the active pnpm lifecycle or the updater-safe Corepack fallback. */
function runScript(script: string, environment: NodeJS.ProcessEnv): void {
  const invocation = buildPnpmInvocation(['run', script], environment)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: resolve(import.meta.dirname, '..'),
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: ${script} exited with ${String(result.status ?? result.signal)}`)
  }
}

/** Parse and validate the optional updater-facing build scope. */
function buildScope(value: string | undefined): BuildScope {
  if (value === undefined || value === 'full') return 'full'
  if (value === 'client') return 'client'
  throw new Error(`build: --scope must be full or client; got ${JSON.stringify(value)}`)
}

/**
 * A fresh isolated Windows runtime can retain TypeScript incremental state
 * without the declaration output of a vendored package. TypeScript may then
 * report Cannot find module '@phoenix-ai/cordis-plugin-include' from an
 * otherwise valid app-boot/CLI source. Repair only the missing dependency
 * JS entry and declaration, not every package or the running Host.
 *
 * Exported as a pure decision so regression tests can simulate missing
 * generated artifacts on any platform.
 */
export function vendoredIncludeTypeRepairNeeded(
  root: string,
  exists: (file: string) => boolean = existsSync,
): boolean {
  const source = resolve(root, 'vendor', 'include', 'src', 'index.ts')
  const outputDir = resolve(root, 'vendor', 'include', 'lib', 'types')
  if (!exists(source)) {
    throw new Error('build: vendored Cordis include source is missing; restore the tracked vendor/include files before building')
  }
  // TS composite incremental state may outlive ignored JS outputs. tsdown
  // consumes index.js, not index.d.ts; both must be present before bundling.
  return !exists(resolve(outputDir, 'index.d.ts'))
    || !exists(resolve(outputDir, 'index.js'))
}

/**
 * Missing pnpm workspace links produce the same unresolved-include symptom as
 * missing declarations. Both consumers must link to vendor/include in the
 * isolated runtime; a successful package install elsewhere proves nothing.
 */
export function missingVendoredIncludeWorkspaceLinks(
  root: string,
  exists: (file: string) => boolean = existsSync,
): string[] {
  return [
    'apps/cli/node_modules/@phoenix-ai/cordis-plugin-include',
    'packages/boot/app-boot/node_modules/@phoenix-ai/cordis-plugin-include',
  ].filter(path => !exists(resolve(root, path)))
}

/** Refresh scoped pnpm workspace links only when a cold runtime lost them. */
function ensureVendoredIncludeWorkspaceLinks(root: string, environment: NodeJS.ProcessEnv): void {
  const missing = missingVendoredIncludeWorkspaceLinks(root)
  if (missing.length === 0) return
  console.log('build: Cordis include workspace links are missing; refreshing frozen dependencies...')
  const invocation = buildPnpmInvocation(['install', '--frozen-lockfile'], environment)
  const installed = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (installed.error !== undefined) throw installed.error
  const remaining = missingVendoredIncludeWorkspaceLinks(root)
  if (installed.status !== 0 || remaining.length > 0) {
    throw new Error('build: Cordis include workspace links are incomplete: ' + remaining.join(', '))
  }
}

/**
 * A persistent Windows updater worktree can keep a valid TypeScript build
 * cache while losing ignored JavaScript outputs. tsdown then fails resolving
 * Cordis's lib/types/{index,invariant,startup}.js entry glob even when the
 * source tree and dependency links are intact. The JS entry (not just its .d.ts)
 * must exist before the Host bundle starts.
 *
 * @param root - Root of the *isolated* runtime being prepared.
 * @param exists - Injectable file probe for cold-runtime regression tests.
 * @returns Whether Cordis must regenerate its emitted bundle entry.
 */
export function vendoredCordisBundleRepairNeeded(
  root: string,
  exists: (file: string) => boolean = existsSync,
): boolean {
  const source = resolve(root, 'vendor', 'cordis', 'src', 'index.ts')
  if (!exists(source)) {
    throw new Error('build: vendored Cordis source is missing; restore tracked vendor/cordis before building')
  }
  return !exists(resolve(root, 'vendor', 'cordis', 'lib', 'types', 'index.js'))
    || !exists(resolve(root, 'vendor', 'cordis', 'lib', 'types', 'index.d.ts'))
}

/**
 * Regenerate Cordis from its own project references before tsdown enumerates
 * workspace entries. This touches only the prepared worktree, never the active
 * Host. --force deliberately bypasses stale .tsbuildinfo from older stages.
 */
function ensureVendoredCordisBundle(root: string, environment: NodeJS.ProcessEnv): void {
  if (!vendoredCordisBundleRepairNeeded(root)) return
  console.log('build: Cordis JS bundle entry is missing; repairing vendor/cordis TypeScript outputs...')
  const invocation = buildPnpmInvocation(['exec', 'tsc', '-b', 'vendor/cordis', '--force'], environment)
  const repaired = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (repaired.error !== undefined) throw repaired.error
  if (repaired.status !== 0 || vendoredCordisBundleRepairNeeded(root)) {
    throw new Error('build: cannot restore vendor/cordis/lib/types/index.js; keeping current Host online')
  }
}

/** Repair missing Include emitted JavaScript/declarations on cold runtime builds. */
function ensureVendoredIncludeTypes(root: string, environment: NodeJS.ProcessEnv): void {
  if (!vendoredIncludeTypeRepairNeeded(root)) return
  console.log('build: Cordis include JS/types entries are missing; rebuilding its TypeScript project references...')
  const invocation = buildPnpmInvocation(['exec', 'tsc', '-b', 'vendor/include', '--force'], environment)
  const repaired = spawnSync(invocation.command, invocation.args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (repaired.error !== undefined) throw repaired.error
  if (repaired.status !== 0 || vendoredIncludeTypeRepairNeeded(root)) {
    throw new Error('build: failed to regenerate vendor/include/lib/types/index.{js,d.ts}; refusing to activate incomplete runtime')
  }
}

/** Ensure generated Host Remote contracts exist before a client-only build. */
function ensureClientHostPrerequisites(environment: NodeJS.ProcessEnv): void {
  if (existsSync(HOST_REMOTE_SENTINEL)) {
    console.log('build: reusing generated Host Remote prerequisites')
    return
  }
  console.log('build: warming generated Host Remote prerequisites once')
  runScript('build:lib:host', environment)
  if (!existsSync(HOST_REMOTE_SENTINEL)) {
    throw new Error('build: Host prerequisite warm-up did not produce plugin-inventory Remote contracts')
  }
}

/** Arm the prepared-update restart bridge for updater-driven incremental client builds. */
function armPreparedRestart(root: string, environment: NodeJS.ProcessEnv): void {
  const bridge = resolve(root, 'scripts', 'phoenix-prepared-restart-bridge.mjs')
  if (!existsSync(bridge)) return
  const result = spawnSync(process.execPath, [bridge, '--arm-staging'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: prepared restart bridge exited with ${String(result.status ?? result.signal)}`)
  }
}

/** Run the full build or the safe client-only incremental build. */
function main(): void {
  const { values } = parseArgs({
    options: {
      profile: { type: 'string' },
      scope: { type: 'string' },
    },
    allowPositionals: false,
  })
  const root = resolve(import.meta.dirname, '..')
  const parentEnvironment = {
    ...process.env,
    DSH_CLIENT_COMMIT_HASH: repositoryCommitHash(root, process.env),
  }
  const clientEnvironment = resolveClientBuildEnvironment(parentEnvironment, values.profile)
  const buildEnvironment = isolateBuildCodexHome(
    root,
    clientBuildProcessEnvironment(parentEnvironment, clientEnvironment),
  )
  const scope = buildScope(values.scope)

  rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
  if (scope === 'full') {
    ensureVendoredIncludeWorkspaceLinks(root, buildEnvironment)
    ensureVendoredIncludeTypes(root, buildEnvironment)
    ensureVendoredCordisBundle(root, buildEnvironment)
    runScript('build:lib', buildEnvironment)
    verifyProfileRuntimeArtifacts(root)
  } else {
    ensureClientHostPrerequisites(buildEnvironment)
    runScript('build:lib:client', buildEnvironment)
  }
  runScript('build:web', buildEnvironment)
  // The updater must never promote a technically buildable runtime whose
  // Phoenix visual chrome/theme was accidentally removed during an upgrade.
  const visualGuard = spawnSync(process.execPath, [resolve(root, 'scripts', 'phoenix-visual-baseline.mjs')], {
    cwd: root,
    env: buildEnvironment,
    stdio: 'inherit',
  })
  if (visualGuard.error !== undefined) throw visualGuard.error
  if (visualGuard.status !== 0) {
    throw new Error('build: Phoenix approved visual baseline is missing; refusing to publish client artifacts')
  }
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: ${scope} recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )

  // Full builds already arm this bridge through the package-level build script.
  // Incremental client builds bypass that wrapper, so arm it here as well.
  // Normal/manual linked-worktree builds remain safe because the bridge itself
  // refuses to restart anything unless it can prove updater/supervisor ancestry.
  if (scope === 'client') armPreparedRestart(root, buildEnvironment)
}

if (import.meta.main) main()
