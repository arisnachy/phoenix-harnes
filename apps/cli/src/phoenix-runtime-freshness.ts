import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'

const ACTIVE_RUNTIME_FILE = 'phoenix-active-runtime.json'
const CLIENT_BUILD_RECORD = '.dsh-build/client-build-environment.json'

interface ActiveRuntimeRecord {
  readonly schema: 1
  readonly target: string
  readonly path: string
}

function gitValue(root: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (result.status !== 0 || typeof result.stdout !== 'string') return undefined
  const value = result.stdout.trim()
  return value.length === 0 ? undefined : value
}

function gitSucceeds(root: string, args: readonly string[]): boolean {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  return result.status === 0
}

function cleanCheckout(root: string): boolean {
  const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0 && typeof result.stdout === 'string' && result.stdout.trim().length === 0
}

function activeRuntimePath(root: string): string | undefined {
  const gitDir = gitValue(root, ['rev-parse', '--git-dir'])
  if (gitDir === undefined) return undefined
  return resolve(isAbsolute(gitDir) ? gitDir : resolve(root, gitDir), ACTIVE_RUNTIME_FILE)
}

function readActiveRuntime(root: string): { readonly path: string; readonly record: ActiveRuntimeRecord } | undefined {
  const markerPath = activeRuntimePath(root)
  if (markerPath === undefined || !existsSync(markerPath)) return undefined
  try {
    const value = JSON.parse(readFileSync(markerPath, 'utf8')) as Partial<ActiveRuntimeRecord>
    if (value.schema !== 1 || typeof value.target !== 'string' || !/^[0-9a-f]{40}$/iu.test(value.target)
      || typeof value.path !== 'string') return undefined
    return { path: markerPath, record: { schema: 1, target: value.target, path: value.path } }
  } catch {
    return undefined
  }
}

/**
 * Choose the code location for the external Windows supervisor.
 *
 * A protected isolated runtime can be newer than the durable source checkout.
 * Launching the supervisor from the stale checkout defeats that protection:
 * updater handoff bugs fixed in the active runtime can still crash before the
 * new Host is activated. Use the verified active worktree for supervisor code
 * while keeping its cwd on the durable checkout, so Git/control state remains
 * anchored there.
 */
export function phoenixSupervisorSourceRoot(root: string): string {
  const sourceRoot = resolve(root)
  const sourceHead = gitValue(sourceRoot, ['rev-parse', 'HEAD'])
  const active = readActiveRuntime(sourceRoot)
  if (sourceHead === undefined || active === undefined) return sourceRoot
  if (sourceCheckoutSupersedesRuntime(sourceRoot, active.record.target, sourceHead)) return sourceRoot

  const candidate = resolve(active.record.path)
  if (!existsSync(join(candidate, 'scripts', 'phoenix-windows-supervisor.mjs'))) return sourceRoot
  if (gitValue(candidate, ['rev-parse', 'HEAD']) !== active.record.target) return sourceRoot

  const sourceCommon = gitValue(sourceRoot, ['rev-parse', '--git-common-dir'])
  const candidateCommon = gitValue(candidate, ['rev-parse', '--git-common-dir'])
  if (sourceCommon === undefined || candidateCommon === undefined) return sourceRoot
  const absoluteSourceCommon = resolve(isAbsolute(sourceCommon) ? sourceCommon : resolve(sourceRoot, sourceCommon))
  const absoluteCandidateCommon = resolve(isAbsolute(candidateCommon) ? candidateCommon : resolve(candidate, candidateCommon))
  if (absoluteSourceCommon.toLowerCase() !== absoluteCandidateCommon.toLowerCase()) return sourceRoot

  return candidate
}

/** Whether a clean source checkout is a newer descendant of a saved isolated runtime. */
export function sourceCheckoutSupersedesRuntime(root: string, target: string, sourceHead?: string): boolean {
  const head = sourceHead ?? gitValue(root, ['rev-parse', 'HEAD'])
  if (head === undefined || head === target || !cleanCheckout(root)) return false
  return gitSucceeds(root, ['merge-base', '--is-ancestor', target, head])
}

function reconcileActiveRuntime(root: string, sourceHead: string): 'source' | 'isolated' {
  const active = readActiveRuntime(root)
  if (active === undefined) return 'source'
  if (!sourceCheckoutSupersedesRuntime(root, active.record.target, sourceHead)) return 'isolated'

  try {
    unlinkSync(active.path)
    console.error(
      `[PHOENIX UPDATE] source checkout ${sourceHead.slice(0, 12)} is newer than the saved isolated runtime ${active.record.target.slice(0, 12)}; retiring the stale runtime marker.`,
    )
  } catch (error) {
    throw new Error(`could not retire stale isolated runtime marker: ${error instanceof Error ? error.message : String(error)}`)
  }
  return 'source'
}

function clientBuildCommit(root: string): string | undefined {
  const path = resolve(root, CLIENT_BUILD_RECORD)
  if (!existsSync(path)) return undefined
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as {
      environment?: { DSH_CLIENT_COMMIT_HASH?: unknown }
    }
    const commit = value.environment?.DSH_CLIENT_COMMIT_HASH
    return typeof commit === 'string' && /^[0-9a-f]{7}$/iu.test(commit) ? commit.toLowerCase() : undefined
  } catch {
    return undefined
  }
}

interface WorkspaceRuntimePackage {
  readonly dir: string
  readonly manifest: {
    readonly name?: unknown
    readonly main?: unknown
    readonly dependencies?: Record<string, string>
    readonly peerDependencies?: Record<string, string>
  }
}

function childDirectories(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
    .map(entry => join(root, entry.name))
}

function workspaceRuntimePackages(root: string): Map<string, WorkspaceRuntimePackage> {
  const candidates = [
    ...childDirectories(join(root, 'vendor')),
    ...childDirectories(join(root, 'packages')).flatMap(group => childDirectories(group)),
    join(root, 'apps', 'cli'),
  ]
  const packages = new Map<string, WorkspaceRuntimePackage>()
  for (const dir of candidates) {
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WorkspaceRuntimePackage['manifest']
      if (typeof manifest.name !== 'string' || manifest.name.length === 0) continue
      packages.set(manifest.name, { dir, manifest })
    } catch {
      // A malformed tracked workspace manifest will fail the actual build too.
      // Freshness only decides whether a build is required; do not mask the
      // build's authoritative diagnostic with a second parser error here.
    }
  }
  return packages
}

/**
 * Return missing built entrypoints in the host runtime dependency closure.
 *
 * The Windows source launcher can otherwise consider the browser bundle fresh
 * while a newly added Host package has no lib output. The profile fallback
 * under ~/.dsh then links correctly to that workspace package, but Loader fails
 * at the package's missing main file (for example dsh-tool-google-workspace).
 * Walking the same app dependency closure keeps the check bounded to packages
 * PHOENIX can actually load, rather than rebuilding for unrelated examples.
 */
export function missingHostRuntimeArtifacts(root: string): string[] {
  const packages = workspaceRuntimePackages(root)
  const queue = ['@phoenix-ai/dsh']
  const seen = new Set<string>()
  const missing: string[] = []

  while (queue.length > 0) {
    const packageName = queue.shift()
    if (packageName === undefined || seen.has(packageName)) continue
    seen.add(packageName)
    const pkg = packages.get(packageName)
    if (pkg === undefined) continue

    const main = pkg.manifest.main
    if (typeof main === 'string' && main.length > 0) {
      const entry = resolve(pkg.dir, main)
      if (!existsSync(entry)) missing.push(relative(root, entry).replaceAll('\\', '/'))
    }

    for (const dependency of [
      ...Object.keys(pkg.manifest.dependencies ?? {}),
      ...Object.keys(pkg.manifest.peerDependencies ?? {}),
    ]) {
      if (packages.has(dependency) && !seen.has(dependency)) queue.push(dependency)
    }
  }

  const cliBin = join(root, 'apps', 'cli', 'lib', 'bin.js')
  if (!existsSync(cliBin)) missing.push(relative(root, cliBin).replaceAll('\\', '/'))
  return [...new Set(missing)].sort()
}

/** Whether the browser bundle recorded for this checkout belongs to the current source commit. */
export function clientArtifactsAreFresh(root: string, sourceHead: string): boolean {
  return clientBuildCommit(root) === sourceHead.slice(0, 7).toLowerCase()
    && existsSync(resolve(root, 'apps', 'web', 'dist', 'index.html'))
}

function runPnpm(root: string, args: readonly string[], label: string): void {
  const command = process.platform === 'win32'
    ? (process.env.ComSpec ?? 'cmd.exe')
    : 'corepack'
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'corepack.cmd', 'pnpm', ...args]
    : ['pnpm', ...args]
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  })
  if (result.error !== undefined) throw result.error
  if ((result.status ?? 1) !== 0) {
    throw new Error(`${label} exited with ${String(result.status ?? result.signal)}`)
  }
}

function rebuildClientArtifacts(root: string): void {
  runPnpm(root, ['exec', 'tsx', 'scripts/build.ts', '--scope', 'client'], 'client freshness rebuild')
}

function rebuildFullRuntime(root: string): void {
  runPnpm(root, ['run', 'build'], 'host runtime rebuild')
}

/** Reconcile saved runtime selection and browser artifacts before the Windows supervisor starts. */
export function preparePhoenixWebRuntime(root: string): void {
  const sourceHead = gitValue(root, ['rev-parse', 'HEAD'])
  if (sourceHead === undefined) return

  // A dirty checkout intentionally keeps the verified isolated runtime. Do not
  // rebuild the source tree behind its back; the supervisor will keep serving
  // the protected runtime until user work is clean again.
  if (reconcileActiveRuntime(root, sourceHead) === 'isolated') return

  const missingHost = missingHostRuntimeArtifacts(root)
  if (missingHost.length > 0) {
    const preview = missingHost.slice(0, 3).join(', ')
    const more = missingHost.length > 3 ? ` (+${String(missingHost.length - 3)} more)` : ''
    console.error(
      `[PHOENIX] host runtime is incomplete for ${sourceHead.slice(0, 12)}: ${preview}${more}; rebuilding the full runtime before launch...`,
    )
    rebuildFullRuntime(root)
    const remaining = missingHostRuntimeArtifacts(root)
    if (remaining.length > 0) {
      throw new Error(`full build completed but Host artifacts are still missing: ${remaining.slice(0, 5).join(', ')}`)
    }
    console.error(`[PHOENIX] host runtime artifacts repaired for ${sourceHead.slice(0, 12)}.`)
  }

  if (clientArtifactsAreFresh(root, sourceHead)) return

  console.error(`[PHOENIX] browser artifacts are stale for ${sourceHead.slice(0, 12)}; rebuilding the client before launch...`)
  rebuildClientArtifacts(root)
  if (!clientArtifactsAreFresh(root, sourceHead)) {
    throw new Error(`client build completed but ${CLIENT_BUILD_RECORD} does not match ${sourceHead.slice(0, 7)}`)
  }
  console.error(`[PHOENIX] browser artifacts now match source ${sourceHead.slice(0, 12)}.`)
}
