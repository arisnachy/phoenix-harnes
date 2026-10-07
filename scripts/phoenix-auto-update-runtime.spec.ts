import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const updater = readFileSync(resolve('scripts/phoenix-auto-update.mjs'), 'utf8')
const supervisor = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')
const managedUpdater = readFileSync(resolve('scripts/phoenix-managed-update.mjs'), 'utf8')
const updatePowerShell = readFileSync(resolve('update-phoenix.ps1'), 'utf8')
const desktop = readFileSync(resolve('apps/desktop-windows/Program.cs'), 'utf8')
const build = readFileSync(resolve('scripts/build.ts'), 'utf8')
const stableWorkflow = readFileSync(resolve('.github/workflows/phoenix-stable-update-channel.yml'), 'utf8')

describe('PHOENIX supervised updater runtime isolation', () => {
  it('promotes each green current main SHA to the stable release pointer', () => {
    expect(stableWorkflow).toContain('Promote stable release pointer')
    expect(stableWorkflow).toContain('"$TARGET_SHA:refs/heads/stable"')
    expect(stableWorkflow).toContain('--force-with-lease="refs/heads/stable:$stable_sha"')
  })

  it('shares updater control markers through the common Git directory across worktrees', () => {
    expect(updater).toContain('function controlDirectory(root)')
    expect(updater).toContain('return gitCommonDirectory(root) ?? gitDirectory(root)')
    expect(updater).toContain('join(controlDirectory(root), STATE_FILE)')
    expect(updater).toContain('join(controlDirectory(root), PREPARED_FILE)')
  })

  it('does not report a checkout as simply current when an older isolated runtime is still marked active', () => {
    expect(updater).toContain("const ACTIVE_RUNTIME_FILE = 'phoenix-active-runtime.json'")
    expect(updater).toContain('function readActiveRuntime(root)')
    expect(updater).toContain('activeRuntime.target !== inspection.current')
    expect(updater).toContain('active isolated runtime is')
    expect(updater).toContain('Restart PHOENIX to reconcile the runtime')
  })

  it('drops a prepared SHA when stable moves during preflight and immediately repolls', () => {
    expect(updater).toContain('function promotedTargetStillCurrent(root, target)')
    expect(updater).toContain("phase: 'superseded'")
    expect(updater).toContain('became stale during preflight')
    expect(updater).toContain('if (!staged.prepared) return false')
    expect(updater).toContain('let repollImmediately = false')
    expect(updater).toContain('if (repollImmediately) continue')
  })

  it('uses a verified active isolated runtime as the effective update baseline', () => {
    expect(updater).toContain('function validatedActiveRuntime(root)')
    expect(updater).toContain('function effectiveCurrentCommit(root)')
    expect(updater).toContain('const activeRuntime = validatedActiveRuntime(root)')
    expect(updater).toContain('const current = activeRuntime?.target ?? sourceCurrent')
    expect(updater).toContain('prepared.base !== effectiveCurrentCommit(root)')
    expect(updater).toContain('already active in the verified isolated runtime; no update action is required')
  })

  it('allows the supervisor to stage stable while the source checkout stays on a development branch', () => {
    expect(updater).toContain("isolatedRuntime: process.env.PHOENIX_UPDATE_SUPERVISED === '1'")
    expect(updater).toContain("case 'isolate':")
  })

  it('loads the active updater but anchors its Git work to the persistent install checkout', () => {
    expect(supervisor).toContain("const activeUpdater = join(runtimeRoot, 'scripts', 'phoenix-auto-update.mjs')")
    expect(supervisor).toContain("const activeShim = join(runtimeRoot, 'scripts', 'phoenix-windows-command-shim.mjs')")
    expect(supervisor).toContain('cwd: root')
    expect(supervisor).toContain('PHOENIX_RUNTIME_ROOT: runtimeRoot')
    expect(supervisor).toContain('PHOENIX_INSTALL_ROOT: root')
  })

  it('clears the consumed prepared marker before relaunching an isolated runtime', () => {
    expect(supervisor).toContain('function clearPreparedRecord()')
    expect(supervisor).toContain('clearPreparedRecord()')
  })

  it('reanchors runtime-prepared candidates to the live HEAD before in-place activation', () => {
    expect(supervisor).toContain('function reanchorPreparedForLiveActivation(target)')
    expect(supervisor).toContain("const liveHead = gitValue(root, ['rev-parse', 'HEAD'])")
    expect(supervisor).toContain('if (prepared.base === liveHead) return true')
    expect(supervisor).toContain("mode: 'full'")
    expect(supervisor).toContain('reanchoredFromBase:')
    expect(supervisor).toContain('if (!reanchorPreparedForLiveActivation(requestedTarget))')
  })

  it('arms the prepared restart bridge after updater-driven incremental client builds', () => {
    expect(build).toContain("if (scope === 'client') armPreparedRestart(root, buildEnvironment)")
    expect(build).toContain("'phoenix-prepared-restart-bridge.mjs'")
    expect(build).toContain("'--arm-staging'")
  })
  it('namespaces persistent updater worktrees per checkout so stale clones cannot block updates', () => {
    expect(updater).toContain("import { createHash } from 'node:crypto'")
    expect(updater).toContain('function stageIdentity(root)')
    expect(updater).toContain('`phoenix-stage-${stageIdentity(root)}`')
    expect(supervisor).toContain('function stageIdentity()')
    expect(supervisor).toContain('`phoenix-stage-${stageIdentity()}`')
    expect(supervisor).toContain('`phoenix-runtime-${stageIdentity()}-${target.slice(0, 12)}`')
  })

  it('self-heals an occupied canonical staging path without deleting unverified data', () => {
    expect(updater).toContain('function quarantineConflictingStagingPath(root, stage)')
    expect(updater).toContain("git(root, ['worktree', 'prune', '--expire', 'now'], { allowFailure: true })")
    expect(updater).toContain('renameSync(stage, quarantine)')
    expect(updater).toContain('quarantined stale/conflicting staging path')
    expect(updater).toContain('if (existsSync(stage) && !sameRepositoryWorktree(root, stage))')
    expect(updater).not.toContain('PHOENIX staging path exists but is not this repository')
  })


  it('caps runtime copies while keeping age-based staging cleanup', () => {
    expect(supervisor).toContain('DEFAULT_UPDATE_STORAGE_RETENTION_MS = 6 * 60 * 60 * 1000')
    expect(supervisor).toContain('PHOENIX_UPDATE_STORAGE_RETENTION_MS')
    expect(supervisor).toContain("process.env.PHOENIX_UPDATE_RUNTIME_BACKUPS ?? ''")
    expect(supervisor).toContain('MAX_INACTIVE_RUNTIME_BACKUPS')
    expect(supervisor).toContain('PHOENIX_UPDATE_RUNTIME_LIMIT')
    expect(supervisor).toContain('MAX_RUNTIME_DIRECTORIES')
    expect(supervisor).toContain('function assertRuntimeStorageCapacity(nextRuntime)')
    expect(supervisor).toContain('runtime storage safety limit reached')
    expect(supervisor).toContain('assertRuntimeStorageCapacity(runtime)')
    expect(supervisor).toContain('DEFAULT_STORAGE_SWEEP_MS = 5 * 60 * 1000')
    expect(supervisor).toContain('PHOENIX_UPDATE_STORAGE_SWEEP_MS')
    expect(supervisor).toContain('nextStorageSweepAt = Date.now() + STORAGE_SWEEP_MS')
    expect(updater).toContain('function cleanupUpdaterRuntimeStorage(root)')
    expect(updater).toContain('updater janitor removed obsolete isolated runtime')
    expect(updater).toContain('function updaterRuntimeStorageHasCapacity(root, target)')
    expect(updater).toContain("process.env.PHOENIX_RUNTIME_ROOT?.trim()")
    expect(updater).toContain("phase: 'storage'")
    expect(supervisor).toContain('function runtimeDirectoriesForCleanup()')
    expect(supervisor).toContain('/^phoenix-runtime-[0-9a-f]{10}-[0-9a-f]{12}$/iu')
    expect(supervisor).toContain('function runtimeProtectedByOwningCheckout(path)')
    expect(supervisor).toContain('const inactiveRuntimes = runtimeDirectoriesForCleanup()')
    expect(supervisor).toContain('if (retainedInactiveRuntimes < MAX_INACTIVE_RUNTIME_BACKUPS)')
    expect(supervisor).not.toContain('if (managedDirectoryAgeMs(candidate) < UPDATE_STORAGE_RETENTION_MS) continue')
    expect(supervisor).toContain('Math.min(UPDATE_STORAGE_RETENTION_MS, 6 * 60 * 60 * 1000)')
    expect(supervisor).toContain('function stageDirectoriesForCleanup()')
    expect(supervisor).toContain('/^phoenix-stage-[0-9a-f]{10}(?:-conflict-\\d+-\\d+)?$/iu')
    expect(supervisor).toContain('if (managedDirectoryAgeMs(candidate) < STAGE_STORAGE_RETENTION_MS) continue')
    expect(supervisor).toContain('removed stale updater staging worktree')
  })

  it('prunes ignored stale workspace shells before reusing persistent staging', () => {
    expect(updater).toContain('function pruneStaleWorkspaceShells(stage)')
    expect(updater).toContain("git(stage, ['ls-files', '--', relativePath]")
    expect(updater).toContain('rmSync(candidate, { recursive: true, force: true })')
    expect(updater).toContain('pruneStaleWorkspaceShells(stage)')
  })

  it('pins updater and nested builds to the pnpm version declared by the project', () => {
    expect(updater).toContain('function projectPnpmSpecifier(root)')
    expect(updater).toContain('[projectPnpmSpecifier(root), ...args.slice(1)]')
    expect(managedUpdater).toContain('const pnpmSpecifier = projectPnpmSpecifier(root)')
    expect(managedUpdater).toContain('command(corepackBin, [pnpmSpecifier, ...args]')
    expect(build).toContain('function projectPnpmSpecifier(root: string)')
    expect(build).toContain("'corepack.cmd', pnpmSpecifier")
    expect(build).toContain('args: [pnpmSpecifier, ...args]')
    expect(build).not.toContain('environment.npm_execpath')
    expect(build).not.toContain('pnpmInvocation(args, environment)')
  })

  it('fails desktop startup closed after a newer stable target is known but cannot be activated', () => {
    expect(managedUpdater).toContain("const STARTUP_CHECK = process.argv.includes('--startup')")
    expect(managedUpdater).toContain('let staleTargetDiscovered = false')
    expect(managedUpdater).toContain('process.exitCode = 13')
    expect(managedUpdater).toContain("blockStaleStartup('update/preflight failed after discovering a newer stable target')")
  })

  it('propagates managed updater semantic exit codes through PowerShell to the desktop', () => {
    expect(updatePowerShell).toContain('if ($null -ne $code -and $code -ne 0) { exit $code }')
    expect(updatePowerShell).toContain('$code -eq 13')
    expect(desktop).toContain('if (updateProcess.ExitCode == 13)')
    expect(desktop).toContain('La versión vieja no se iniciará')
  })

})
