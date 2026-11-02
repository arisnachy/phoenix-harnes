import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Optional, locally managed ClawHub registry CLI. Never load marketplace code in PHOENIX's Host process. */
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const packageRoot = join(dshHome, 'toolchains', 'clawhub', 'node_modules', 'clawhub')
const packageJson = join(packageRoot, 'package.json')
const statusPath = join(dshHome, 'toolchains', 'clawhub-status.json')
const PACKAGE_ID = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9][a-zA-Z0-9._+-]*)?$/u
const SEARCH = /^[\p{L}\p{N} ._\/-]{1,80}$/u
// A single contract must serve the implementation and @Remote return types.
// Re-exporting preserves imports from this module without duplicating shapes.
import type {
  ClawHubListing, ClawHubQuery, ClawHubInstallRequest,
  ClawHubInstallReceipt, ClawHubState,
} from './types.ts'
export type {
  ClawHubFamily, ClawHubListing, ClawHubQuery, ClawHubInstallRequest,
  ClawHubInstallReceipt, ClawHubState,
} from './types.ts'

function managedCli(): string | undefined {
  try {
    if (!existsSync(packageJson)) return undefined
    const pkg: unknown = JSON.parse(readFileSync(packageJson, 'utf8'))
    if (pkg === null || typeof pkg !== 'object') return undefined
    const bin = (pkg as { bin?: string | Record<string, string> }).bin
    const rel = typeof bin === 'string' ? bin : bin?.clawhub
    if (typeof rel !== 'string' || rel.includes('..') || rel.startsWith('/') || rel.includes('\\')) return undefined
    const filename = join(packageRoot, rel)
    return existsSync(filename) ? filename : undefined
  } catch { return undefined }
}

interface ExecutionResult { status: number; stdout: string; stderr: string }
async function run(command: string, args: readonly string[], timeoutMs = 30_000): Promise<ExecutionResult> {
  return await new Promise((resolve, reject) => {
    const windowsCmd = process.platform === 'win32' && command !== process.execPath
    // The Windows cmd proxy is used only with validated package IDs, family and search query.
    const child = spawn(windowsCmd ? 'cmd.exe' : command,
      windowsCmd ? ['/d', '/s', '/c', command, ...args] : [...args],
      { cwd: dshHome, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('ClawHub command timed out')) }, timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (piece: string) => { stdout = (stdout + piece).slice(-150_000) })
    child.stderr.on('data', (piece: string) => { stderr = (stderr + piece).slice(-8_000) })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ status: code ?? -1, stdout, stderr })
    })
  })
}

async function clawHub(args: string[]): Promise<ExecutionResult> {
  const cli = managedCli()
  return cli === undefined ? run(process.platform === 'win32' ? 'clawhub.cmd' : 'clawhub', args)
    : run(process.execPath, [cli, ...args])
}
function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown } catch { throw new Error('ClawHub returned invalid JSON') }
}
function record(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
}
function string(v: unknown): string { return typeof v === 'string' ? v : '' }
function candidates(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const obj = record(value)
  for (const key of ['packages', 'items', 'results', 'entries']) if (Array.isArray(obj[key])) return obj[key] as unknown[]
  return []
}
async function available(binary: string): Promise<boolean> {
  try { return (await run(binary, ['--version'], 5_000)).status === 0 } catch { return false }
}

/** Metadata-only readiness: a CLI on disk does NOT mean a plugin is active for Kira. */
export async function clawHubState(): Promise<ClawHubState> {
  const localEntry = managedCli()
  const managed = localEntry !== undefined
    && (await run(process.execPath, [localEntry, '--version'], 7_000).then(x => x.status === 0, () => false)
      || await run(process.execPath, [localEntry, '--help'], 7_000).then(x => x.status === 0, () => false))
  const global = !managed && await available(process.platform === 'win32' ? 'clawhub.cmd' : 'clawhub')
  const metadata: unknown = (() => {
    try { return JSON.parse(readFileSync(statusPath, 'utf8')) as unknown } catch { return null }
  })()
  const status = metadata !== null && typeof metadata === 'object'
    ? metadata as Record<string, unknown> : {}
  const ready = managed || global
  const reportedState = status.state
  const cliStatus = ready ? 'ready'
    : reportedState === 'installing' && typeof status.checkedAt === 'number'
      && Date.now() - status.checkedAt < 180_000 ? 'installing'
    : reportedState === 'incompatible-node' ? 'incompatible-node'
    : reportedState === 'install-failed' ? 'install-failed'
    : 'missing'
  const reason = status.reason
  const failureReason = reason === 'npm-cli-not-found' || reason === 'registry-unreachable'
    || reason === 'npm-install-or-cli-health-check-failed' ? reason : undefined
  let version: string | undefined
  if (managed) {
    try {
      const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: string }
      version = pkg.version
    } catch { /* do not surface invalid package metadata */ }
  } else if (global && typeof status.version === 'string') {
    version = status.version
  }
  const openclawManifest = join(dshHome, 'toolchains', 'openclaw', 'node_modules', 'openclaw', 'package.json')
  let managedOpenClaw: string | undefined
  try {
    const pkg = JSON.parse(readFileSync(openclawManifest, 'utf8')) as { bin?: string | { openclaw?: string } }
    const file = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.openclaw
    if (typeof file === 'string' && !file.includes('..') && !file.startsWith('/')) {
      const entry = join(dshHome, 'toolchains', 'openclaw', 'node_modules', 'openclaw', file)
      if (existsSync(entry)) managedOpenClaw = entry
    }
  } catch { /* no managed CLI */ }
  const openclaw = managedOpenClaw !== undefined
    ? (await run(process.execPath, [managedOpenClaw, '--version'], 5_000).then(x => x.status === 0, () => false))
    : await available(process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw')
  return {
    cli: managed ? 'managed' : global ? 'global' : 'missing',
    openclaw: openclaw ? 'available' : 'missing',
    skillsDirectory: join(dshHome, 'skills'),
    pluginExecution: openclaw ? 'openclaw-runtime' : 'not-configured',
    cliStatus,
    ...(version === undefined ? {} : { cliVersion: version }),
    ...(typeof status.latestVersion === 'string' ? { latestCliVersion: status.latestVersion } : {}),
    ...(typeof status.checkedAt === 'number' ? { lastCheckedAt: status.checkedAt } : {}),
    ...(failureReason === undefined ? {} : { failureReason }),
  }
}

/** Queries the independent ClawHub package registry; no plugin code runs during search. */
export async function clawHubExplore(request: ClawHubQuery): Promise<readonly ClawHubListing[]> {
  const query = request.query.trim()
  if (!SEARCH.test(query)) throw new Error('Enter a short text search with letters, numbers or spaces')
  if (!['skill', 'code-plugin', 'bundle-plugin'].includes(request.family)) throw new Error('Unsupported package family')
  const limit = Math.min(30, Math.max(1, Math.trunc(request.limit ?? 12)))
  const answer = await clawHub(['--no-input', 'package', 'explore', query, '--family', request.family, '--limit', String(limit), '--json'])
  if (answer.status !== 0) throw new Error('ClawHub catalog unavailable; check network and CLI')
  return candidates(parseJson(answer.stdout)).slice(0, limit).map(item => {
    const raw = record(item)
    const pkg = record(raw.package)
    const release = record(raw.latestVersion)
    return {
      name: string(raw.name) || string(raw.packageName) || string(pkg.name) || string(raw.slug),
      family: request.family,
      description: (string(raw.summary) || string(raw.description) || string(pkg.summary)).slice(0, 420),
      version: string(raw.version) || string(release.version) || string(raw.latestVersion) || 'unknown',
    }
  }).filter(item => PACKAGE_ID.test(item.name))
}

/** Install only a recognized package locator into the user skill root or an existing OpenClaw runtime. */
export async function clawHubInstall(request: ClawHubInstallRequest): Promise<ClawHubInstallReceipt> {
  if (!PACKAGE_ID.test(request.name) || request.name.length > 128) throw new Error('Invalid ClawHub package identifier')
  if (!['skill', 'code-plugin', 'bundle-plugin'].includes(request.family)) throw new Error('Unsupported package family')
  if (request.family === 'skill') {
    const response = await clawHub(['--workdir', dshHome, '--dir', 'skills', '--no-input', 'install', request.name])
    if (response.status !== 0) throw new Error('Skill installation failed; no verified installation receipt')
    return { name: request.name, family: request.family, status: 'installed-skill', detail: 'Installed to PHOENIX skills. Review its instructions before invoking.' }
  }
  if (!(await available(process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw'))) {
    throw new Error('OpenClaw runtime is required for native plugins. ClawHub CLI alone cannot execute plugins.')
  }
  const response = await run(process.platform === 'win32' ? 'openclaw.cmd' : 'openclaw',
    ['plugins', 'install', 'clawhub:' + request.name, '--no-enable'], 120_000)
  if (response.status !== 0) throw new Error('OpenClaw plugin installation failed; inspect the runtime before retrying')
  return {
    name: request.name, family: request.family, status: 'installed-in-openclaw',
    detail: 'Installed disabled in OpenClaw. Activation and PHOENIX tool routing still require a compatible runtime bridge.',
  }
}

// Browser-initiated repair uses the same idempotent, rollback-safe bootstrap as
// the PHOENIX updater. No arbitrary executable or package name comes from UI.
let prepareInFlight: Promise<ClawHubState> | undefined
export function prepareClawHubCli(): Promise<ClawHubState> {
  if (prepareInFlight !== undefined) return prepareInFlight
  prepareInFlight = (async () => {
    let root = resolve(process.cwd())
    let script: string | undefined
    for (let depth = 0; depth < 9; depth++) {
      const candidate = join(root, 'scripts', 'phoenix-clawhub-bootstrap.mjs')
      if (existsSync(candidate)) { script = candidate; break }
      const parent = dirname(root)
      if (parent === root) break
      root = parent
    }
    if (script === undefined) throw new Error('PHOENIX ClawHub installer not found in this checkout')
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(process.execPath, [script, '--ensure', '--update', '--force'], {
        windowsHide: true, stdio: 'ignore', shell: false,
      })
      const timeout = setTimeout(() => { child.kill(); reject(new Error('ClawHub preparation timed out')) }, 170_000)
      child.once('error', () => { clearTimeout(timeout); reject(new Error('ClawHub installer could not start')) })
      child.once('close', code => {
        clearTimeout(timeout)
        if (code === 0) resolvePromise()
        else reject(new Error('ClawHub installer returned an error'))
      })
    })
    return clawHubState()
  })().finally(() => { prepareInFlight = undefined })
  return prepareInFlight
}
