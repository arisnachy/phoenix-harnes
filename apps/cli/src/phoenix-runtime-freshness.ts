import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import process from 'node:process'

const ACTIVE_RUNTIME_FILE = 'phoenix-active-runtime.json'
const CLIENT_BUILD_RECORD = '.dsh-build/client-build-environment.json'
const KIRA_PORTRAIT_ARTIFACT = ['apps', 'web', 'dist', 'assets', 'kira-agents', 'kira-portraits.webp'] as const

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

function readActiveRuntime(root: string): { readonly path: string, readonly record: ActiveRuntimeRecord } | undefined {
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

/** Whether the browser bundle recorded for this checkout is complete and belongs to the current source commit. */
export function clientArtifactsAreFresh(root: string, sourceHead: string): boolean {
  return clientBuildCommit(root) === sourceHead.slice(0, 7).toLowerCase()
    && existsSync(resolve(root, 'apps', 'web', 'dist', 'index.html'))
    && existsSync(resolve(root, ...KIRA_PORTRAIT_ARTIFACT))
}

function rebuildClientArtifacts(root: string): void {
  const command = process.platform === 'win32'
    ? (process.env.ComSpec ?? 'cmd.exe')
    : 'corepack'
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'corepack.cmd', 'pnpm', 'exec', 'tsx', 'scripts/build.ts', '--scope', 'client']
    : ['pnpm', 'exec', 'tsx', 'scripts/build.ts', '--scope', 'client']
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: false,
  })
  if (result.error !== undefined) throw result.error
  if ((result.status ?? 1) !== 0) {
    throw new Error(`client freshness rebuild exited with ${String(result.status ?? result.signal)}`)
  }
}

/** Reconcile saved runtime selection and browser artifacts before the Windows supervisor starts. */
export function preparePhoenixWebRuntime(root: string): void {
  const sourceHead = gitValue(root, ['rev-parse', 'HEAD'])
  if (sourceHead === undefined) return

  // A dirty checkout intentionally keeps the verified isolated runtime. Do not
  // rebuild the source tree behind its back; the supervisor will keep serving
  // the protected runtime until user work is clean again.
  if (reconcileActiveRuntime(root, sourceHead) === 'isolated') return
  if (clientArtifactsAreFresh(root, sourceHead)) return

  console.error(`[PHOENIX] browser artifacts are stale or incomplete for ${sourceHead.slice(0, 12)}; rebuilding the client before launch...`)
  rebuildClientArtifacts(root)
  if (!clientArtifactsAreFresh(root, sourceHead)) {
    throw new Error(`client build completed but required web artifacts do not match ${sourceHead.slice(0, 7)}`)
  }
  console.error(`[PHOENIX] browser artifacts now match source ${sourceHead.slice(0, 12)}.`)
}