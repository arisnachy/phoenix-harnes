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
import { pnpmInvocation } from './pnpm-invocation.ts'

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

/** Resolve the repository-pinned pnpm package-manager specifier. */
function projectPnpmSpecifier(root: string): string {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { packageManager?: unknown }
  const configured = typeof manifest.packageManager === 'string' ? manifest.packageManager.trim() : ''
  if (!/^pnpm@[^\\s]+$/u.test(configured)) {
    throw new Error(`build: package.json must pin packageManager to pnpm@<version>; got ${JSON.stringify(manifest.packageManager)}`)
  }
  return configured
}

/** Resolve pnpm even when the stable updater launches this script outside a pnpm lifecycle. */
function buildPnpmInvocation(args: readonly string[], environment: NodeJS.ProcessEnv): { command: string; args: string[] } {
  if (environment.npm_execpath !== undefined && environment.npm_execpath !== '') {
    return pnpmInvocation(args, environment)
  }
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
    runScript('build:lib', buildEnvironment)
  } else {
    ensureClientHostPrerequisites(buildEnvironment)
    runScript('build:lib:client', buildEnvironment)
  }
  runScript('build:web', buildEnvironment)
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
