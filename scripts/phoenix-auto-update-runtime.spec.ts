import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const updater = readFileSync(resolve('scripts/phoenix-auto-update.mjs'), 'utf8')
const supervisor = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')
const managedUpdater = readFileSync(resolve('scripts/phoenix-managed-update.mjs'), 'utf8')
const updatePowerShell = readFileSync(resolve('update-phoenix.ps1'), 'utf8')
const storageRepair = readFileSync(resolve('scripts/phoenix-windows-storage-repair.ps1'), 'utf8')
const desktop = readFileSync(resolve('apps/desktop-windows/Program.cs'), 'utf8')
const build = readFileSync(resolve('scripts/build.ts'), 'utf8')
const stableWorkflow = readFileSync(resolve('.github/workflows/phoenix-stable-update-channel.yml'), 'utf8')

describe('failed isolated runtime storage reclamation', () => {
  it('reclaims only a failed unactivated candidate after a build error', () => {
    const start = supervisor.indexOf('function cleanupFailedPreparedRuntime(target) {')
    const end = supervisor.indexOf('\nfunction assertRuntimeStorageCapacity(nextRuntime) {', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const remove = vi.fn(() => true)
    const registered = new Set(['failed-runtime'])
    let candidate = 'failed-runtime'
    let active = { path: 'live-marker' }
    let protectedByCheckout = false
    const { cleanupFailedPreparedRuntime } = runInNewContext(
      supervisor.slice(start, end) + '\n({ cleanupFailedPreparedRuntime })',
      {
        persistentRuntime: () => candidate,
        runtimePathKey: (path: string) => path.toLowerCase(),
        runtimeRoot: 'running-host',
        root: 'checkout',
        readActiveRuntimeRecord: () => active,
        existsSync: () => true,
        runtimeProtectedByOwningCheckout: () => protectedByCheckout,
        registeredWorktreePaths: () => registered,
        removeManagedWorktree: remove,
        console: { error: () => {} },
      },
    ) as { cleanupFailedPreparedRuntime: (target: string) => void }
    cleanupFailedPreparedRuntime('sha')
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith('failed-runtime', registered, true)

    for (const protectedPath of ['running-host', 'checkout', 'live-marker']) {
      candidate = protectedPath
      cleanupFailedPreparedRuntime('sha')
    }
    expect(remove).toHaveBeenCalledTimes(1)

    candidate = 'owned-by-other-checkout'
    protectedByCheckout = true
    cleanupFailedPreparedRuntime('sha')
    expect(remove).toHaveBeenCalledTimes(1)
    protectedByCheckout = false
    active = { path: 'another-live-host' }
    cleanupFailedPreparedRuntime('sha')
    expect(remove).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenLastCalledWith('owned-by-other-checkout', registered, true)
  })
})

describe('optional live update helper fallback', () => {
  const start = supervisor.indexOf('function runChecked(cwd, bin, args, label) {')
  const end = supervisor.indexOf('\nfunction runPnpm(cwd, args, label) {', start)
  const runner = supervisor.slice(start, end) + '\n({ runChecked })'

  it('prewarms an isolated replacement with the native Git command when the old helper is absent', () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: null, stderr: null }))
    const steps = vi.fn()
    const errors = vi.fn()
    const { runChecked } = runInNewContext(runner, {
      restartRequestTarget: () => 'a'.repeat(40),
      readUpdateState: () => ({ target: 'a'.repeat(40) }),
      updateStatePath: () => 'state.json',
      supervisorSourceRoot: 'old-runtime',
      pinPhoenixUpdateLiveHelper: () => undefined,
      validPinnedPhoenixUpdateLiveHelper: () => false,
      pinnedLiveHelper: undefined,
      existsSync: () => false,
      join,
      process: { execPath: 'node.exe', env: {} },
      hideRuntimeWindows: true,
      missingLiveHelperReported: false,
      spawnSync: spawn,
      reportSupervisorStep: steps,
      console: { error: errors },
    }) as { runChecked: (cwd: string, bin: string, args: string[], label: string) => void }

    runChecked('checkout', 'git', ['worktree', 'add', '--detach', 'replacement', 'target'],
      'create isolated runtime worktree')
    expect(spawn).toHaveBeenCalledWith('git', ['worktree', 'add', '--detach', 'replacement', 'target'],
      expect.objectContaining({ cwd: 'checkout', stdio: 'inherit' }))
    expect(steps).toHaveBeenNthCalledWith(1, 'git-worktree', 'started')
    expect(steps).toHaveBeenNthCalledWith(2, 'git-worktree', 'ok', 0)
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('optional live output helper missing'))
    expect(updater).toContain('const directStream = liveEligible && !streamLive')
    expect(updater).toContain("stdio: streamLive || directStream ? 'inherit'")
  })

  it('reports a real failing native command rather than a missing Node module error', () => {
    const spawn = vi.fn(() => ({ status: 31, stdout: null, stderr: null }))
    const steps = vi.fn()
    const { runChecked } = runInNewContext(runner, {
      restartRequestTarget: () => 'b'.repeat(40),
      readUpdateState: () => undefined,
      updateStatePath: () => 'state.json',
      supervisorSourceRoot: 'old-runtime',
      pinPhoenixUpdateLiveHelper: () => undefined,
      validPinnedPhoenixUpdateLiveHelper: () => false,
      pinnedLiveHelper: undefined,
      existsSync: () => false,
      join,
      process: { execPath: 'node.exe', env: {} },
      hideRuntimeWindows: true,
      missingLiveHelperReported: false,
      spawnSync: spawn,
      reportSupervisorStep: steps,
      console: { error: vi.fn() },
    }) as { runChecked: (cwd: string, bin: string, args: string[], label: string) => void }

    expect(() => {
      runChecked('checkout', 'git', ['worktree', 'add'], 'create isolated runtime worktree')
    }).toThrow('create isolated runtime worktree exited with 31')
    expect(steps).toHaveBeenCalledWith('git-worktree', 'failed', 31, '')
    expect(spawn).toHaveBeenCalledWith('git', ['worktree', 'add'],
      expect.objectContaining({ cwd: 'checkout', stdio: 'inherit' }))
  })

  it('streams rich journal output from a pinned helper outside the disposable runtime', () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: null, stderr: null }))
    const { runChecked } = runInNewContext(runner, {
      restartRequestTarget: () => 'c'.repeat(40),
      readUpdateState: () => undefined,
      updateStatePath: () => 'state.json',
      supervisorSourceRoot: 'runtime',
      pinPhoenixUpdateLiveHelper: () => join('durable-git', 'verified-pair', 'phoenix-update-live-command.mjs'),
      validPinnedPhoenixUpdateLiveHelper: () => true,
      pinnedLiveHelper: undefined,
      existsSync: () => true,
      join,
      process: { execPath: 'node.exe', env: {} },
      hideRuntimeWindows: true,
      missingLiveHelperReported: false,
      spawnSync: spawn,
      reportSupervisorStep: vi.fn(),
      console: { error: vi.fn() },
    }) as { runChecked: (cwd: string, bin: string, args: string[], label: string) => void }

    runChecked('checkout', 'git', ['status'], 'create isolated runtime worktree')
    expect(spawn).toHaveBeenCalledWith('node.exe', [
      join('durable-git', 'verified-pair', 'phoenix-update-live-command.mjs'),
      JSON.stringify({
        cwd: 'checkout', bin: 'git', args: ['status'], step: 'git-worktree',
        target: 'c'.repeat(40), statePath: 'state.json',
      }),
    ], expect.objectContaining({ cwd: 'checkout', stdio: 'inherit' }))
  })
})

describe('PHOENIX supervised updater runtime isolation', () => {
  it('does not launch a duplicate web host into a busy 3080 port or kill the current listener', () => {
    expect(supervisor).toContain("import { createServer } from 'node:net'")
    expect(supervisor).toContain('function existingHostOnPort(port)')
    expect(supervisor).toContain('if (port !== undefined && await existingHostOnPort(port))')
    expect(supervisor).toContain('finalCode = 0')
    expect(supervisor).not.toContain('taskkill /IM node.exe')
  })

  it('limits offline watcher fetch latency while preserving manual refresh and live Host', () => {
    expect(updater).toContain('const WATCH_FETCH_TIMEOUT_MS = 9_000')
    expect(updater).toContain('timeout: options.timeoutMs')
    expect(updater).toContain('fetchTimeoutMs: WATCH_FETCH_TIMEOUT_MS')
    expect(updater).toContain('const MAX_NETWORK_BACKOFF_MS = 15 * 60 * 1000')
    expect(updater).toContain('const NETWORK_WARNING_INTERVAL_MS = 15 * 60 * 1000')
    expect(updater).toContain('now - lastNetworkWarningAt >= NETWORK_WARNING_INTERVAL_MS')
    expect(updater).toContain('await waitForPollOrParentExit(root, parentPid, retryMs)')
    expect(updater).toContain('status: \'checking\',')
    expect(updater).not.toContain('throw new Error(\'PHOENIX shutdown due to offline')
  })

  it('promotes each green current main SHA to the stable release pointer', () => {
    expect(stableWorkflow).toContain('Keep stable exactly aligned with main')
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

  it('retires stale prepared state when an independently activated runtime already owns the target SHA', () => {
    const begin = updater.indexOf('function reconcileAlreadyActiveTarget(root, inspection)')
    const end = updater.indexOf('\nfunction writePreparedState(', begin)
    expect(begin).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(begin)
    const source = updater.slice(begin, end)
    const writes: Record<string, unknown>[] = []
    const cleared: string[] = []
    const active = { target: 'a'.repeat(40), path: 'active-runtime' }
    const { reconcileAlreadyActiveTarget } = runInNewContext(
      source + '\n({ reconcileAlreadyActiveTarget })',
      {
        validatedActiveRuntime: () => active,
        clearPrepared: () => { cleared.push('prepared') },
        readRestartRequest: () => ({ target: active.target }),
        clearRestartRequest: () => { cleared.push('restart') },
        writeState: (_root: string, state: Record<string, unknown>) => { writes.push(state) },
        console: { error: () => {} },
      },
    ) as { reconcileAlreadyActiveTarget: (root: string, inspection: { target: string; sourceCurrent: string }) => boolean }
    expect(reconcileAlreadyActiveTarget('checkout', { target: 'b'.repeat(40), sourceCurrent: 'c'.repeat(40) })).toBe(false)
    expect(writes).toHaveLength(0)
    expect(reconcileAlreadyActiveTarget('checkout', { target: active.target, sourceCurrent: 'c'.repeat(40) })).toBe(true)
    expect(cleared).toEqual(['prepared', 'restart'])
    expect(writes).toMatchObject([{ status: 'current', phase: 'idle', current: active.target, runtimePath: 'active-runtime' }])
    expect(updater).toContain('if (reconcileAlreadyActiveTarget(root, inspection)) return')
    expect(updater).toContain('if (reconcileAlreadyActiveTarget(root, inspection)) {')
    expect(updater).toContain('repollImmediately = true')
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


  it('retries orphan cleanup after Windows releases exited Host and updater handles', () => {
    const finish = supervisor.lastIndexOf('await stopWatcherSupervisor()')
    const close = supervisor.indexOf('supervisorInstanceLock?.close()', finish)
    expect(finish).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(finish)
    expect(supervisor.slice(finish, close)).toContain('cleanupObsoleteRuntimes()')
    expect(supervisor.slice(finish, close)).toContain('final storage cleanup deferred')
  })

  it('does not let other checkouts exhaust this Windows runtime quota', () => {
    const begin = supervisor.indexOf('function runtimeDirectoriesForCleanup()')
    const end = supervisor.indexOf('\nfunction stageDirectoriesForCleanup()', begin)
    expect(begin).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(begin)
    const source = supervisor.slice(begin, end) + '\n({ runtimeDirectoriesForCleanup })'
    const currentId = 'c844c9f3ab'
    const otherId = 'abcde12345'
    const names = [
      `phoenix-runtime-${currentId}-0123456789ab`,
      `phoenix-runtime-${otherId}-aaaaaaaaaaaa`,
      `phoenix-runtime-${otherId}-bbbbbbbbbbbb`,
      'phoenix-runtime-unmanaged',
    ]
    const { runtimeDirectoriesForCleanup } = runInNewContext(source, {
      runtimeBaseDirectory: () => 'p',
      stageIdentity: () => currentId,
      readdirSync: () => names.map(name => ({ name, isDirectory: () => true })),
      join,
    }) as { runtimeDirectoriesForCleanup: () => string[] }
    expect(runtimeDirectoriesForCleanup()).toEqual([join('p', names[0]!)])
  })

  it('offline repair uses the owning checkout identity and never reports a locked 3/3 as success', () => {
    expect(storageRepair).toContain('rev-parse --git-common-dir')
    expect(storageRepair).toContain('[System.Security.Cryptography.SHA256]::Create()')
    expect(storageRepair).toContain('[regex]::Escape($identity)')
    expect(storageRepair).toContain('if ($after.Count -ge $configuredLimit)')
    expect(storageRepair).toContain('cleanup could not free runtime capacity')
    expect(storageRepair).toContain('Close Phoenix normally before -Apply')
    expect(storageRepair).toContain('Get-CimInstance Win32_Process')
    expect(storageRepair).toContain('Select-Object ProcessId, Name')
    expect(storageRepair).toContain('Associated Handles')
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
    expect(updater).toContain('function cleanupUpdaterRuntimeStorage(root, { ensureCapacity = false } = {})')
    expect(updater).toContain('updater janitor removed obsolete isolated runtime')
    expect(updater).toContain('function updaterRuntimeStorageHasCapacity(root, target)')
    expect(updater).toContain('process.env.PHOENIX_RUNTIME_ROOT?.trim()')
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

  it('actually releases a spare backup after EBUSY without touching the running Host or locked orphan', () => {
    const begin = updater.indexOf('function cleanupUpdaterRuntimeStorage(root,')
    const end = updater.indexOf('\nfunction sameRepositoryWorktree(root,', begin)
    expect(begin).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(begin)
    const routines = updater.slice(begin, end)

    const base = join('phoenix', 'p')
    const active = join(base, 'phoenix-runtime-sim-active')
    const backup = join(base, 'phoenix-runtime-sim-backup')
    const busy = join(base, 'phoenix-runtime-sim-busy')
    const paths = new Set([active, backup, busy])
    const attempts: string[] = []
    const warnings = vi.fn()
    const environment = {
      MAX_INACTIVE_RUNTIME_BACKUPS: 1,
      MAX_RUNTIME_DIRECTORIES: 3,
      STORAGE_WARNING_INTERVAL_MS: 15 * 60 * 1000,
      stageBaseDirectory: () => base,
      stageIdentity: () => 'sim',
      join,
      existsSync: () => false,
      runtimePathKey: (path: string) => path.toLowerCase(),
      readActiveRuntime: () => ({ path: active }),
      updaterRegisteredWorktrees: () => new Set(paths),
      updaterRuntimeDirectories: () => [...paths],
      updaterRuntimeMtimeMs: (path: string) => path === backup ? 300 : path === busy ? 100 : 400,
      removeUpdaterRuntime: (_root: string, path: string) => {
        attempts.push(path)
        if (path === busy) return false // EBUSY from the attached diagnostic log
        paths.delete(path)
        return true
      },
      git: () => ({ ok: true }),
      process: { env: { PHOENIX_RUNTIME_ROOT: active } },
      console: { error: warnings },
    }
    const source = 'let lastStorageWarningAt = Number.NEGATIVE_INFINITY;\n'
      + routines + '\n({ updaterRuntimeStorageHasCapacity })'
    const { updaterRuntimeStorageHasCapacity } = runInNewContext(source, environment) as {
      updaterRuntimeStorageHasCapacity: (root: string, target: string) => boolean
    }
    expect(updaterRuntimeStorageHasCapacity('checkout', 'a'.repeat(40))).toBe(true)
    expect(paths.has(active)).toBe(true)
    expect(paths.has(busy)).toBe(true)
    expect(paths.has(backup)).toBe(false)
    expect(attempts).not.toContain(active)
    expect(warnings.mock.calls.some(call => String(call[0]).includes('reclaimed inactive rollback'))).toBe(true)
  })

  it('recovers from a busy orphan at 3/3 by evicting ONLY an unprotected inactive backup', () => {
    expect(updater).toContain('const rollbackCandidates = []')
    expect(updater).toContain('if (retained < MAX_INACTIVE_RUNTIME_BACKUPS)')
    expect(updater).toContain('rollbackCandidates.push(candidate)')
    expect(updater).toContain('if (ensureCapacity) {')
    expect(updater).toContain('for (const candidate of rollbackCandidates.reverse())')
    expect(updater).toContain('if (updaterRuntimeDirectories(root).length < MAX_RUNTIME_DIRECTORIES) break')
    expect(updater).toContain('cleanupUpdaterRuntimeStorage(root, { ensureCapacity: true })')
    expect(updater).toContain('if (active?.path !== undefined) keep.add(runtimePathKey(active.path))')
    expect(updater).toContain('process.env.PHOENIX_RUNTIME_ROOT?.trim()')
    expect(updater).toContain('if (existsSync(targetRuntime)) return true')
    expect(supervisor).toContain('function reclaimInactiveBackupForCapacity(nextRuntime)')
    expect(supervisor).toContain('!runtimeProtectedByOwningCheckout(path)')
    expect(supervisor).toContain('if (runtimeDirectoriesForCleanup().length < MAX_RUNTIME_DIRECTORIES) break')
    expect(supervisor).toContain('reclaimInactiveBackupForCapacity(nextRuntime)')
    expect(supervisor).toContain('if (active?.path) keep.add(runtimePathKey(active.path))')
  })

  it('keeps clean release checkouts updatable when Windows locks a stale isolated runtime', () => {
    expect(updater).toContain("const inPlaceFallbackEligible = action === 'apply'")
    expect(updater).toContain("inspection.status === 'upgrade'")
    expect(updater).toContain('inspection.current === inspection.sourceCurrent')
    expect(updater).toContain('inspection.activeRuntime === undefined')
    expect(updater).toContain('readActiveRuntime(root) === undefined')
    expect(updater).toContain('cleanWorktree(root)')
    expect(updater).toContain('if (inPlaceFallbackEligible) {')
    expect(supervisor).toContain('function safeInPlacePreparedFallback(target)')
    expect(supervisor).toContain('runtimeRoot !== root || readActiveRuntimeRecord() !== undefined')
    expect(supervisor).toContain("gitSucceeds(root, ['merge-base', '--is-ancestor', current, target])")
    expect(supervisor).toContain('safe-inplace-update-handoff')
    expect(supervisor).toContain("if (hostEvent.kind === 'safe-inplace-update-handoff')")
    expect(supervisor).toContain('const activationCode = activatePrepared()')
  })

  it('shows orphaned-runtime EBUSY only when storage capacity is truly blocked', () => {
    expect(supervisor).toContain('const storageAtHardCap = runtimeDirectoriesForCleanup().length >= MAX_RUNTIME_DIRECTORIES')
    expect(supervisor).toContain('cleanupObsoleteRuntimes([runtimeRoot], { reportBusy: storageAtHardCap })')
    expect(supervisor).toContain('const busyManagedRuntimeRetryAt = new Map()')
  })

  it('defers routine Windows EBUSY cleanup quietly but exposes capacity-critical locks', () => {
    const begin = supervisor.indexOf('const busyManagedRuntimeRetryAt = new Map()')
    const end = supervisor.indexOf('\nfunction removeManagedWorktree(', begin)
    expect(begin).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(begin)
    const routines = supervisor.slice(begin, end)
    const warnings = vi.fn()
    const attempted: string[] = []
    const { removeOrphanedManagedDirectory } = runInNewContext(
      routines + '\n({ removeOrphanedManagedDirectory })',
      {
        runtimePathKey: (path: string) => path,
        rmSync: (path: string) => {
          attempted.push(path)
          const err = new Error('Windows still holds a runtime handle') as NodeJS.ErrnoException
          err.code = 'EBUSY'
          throw err
        },
        existsSync: () => true,
        console: { error: warnings },
      },
    ) as { removeOrphanedManagedDirectory: (path: string, reportBusy?: boolean) => boolean }
    // Normal idle janitor must not fill the build console with warnings.
    expect(removeOrphanedManagedDirectory('old-runtime', false)).toBe(false)
    expect(warnings).not.toHaveBeenCalled()
    // Actual full-capacity recovery still exposes the actionable lock.
    expect(removeOrphanedManagedDirectory('critical-runtime', true)).toBe(false)
    expect(warnings).toHaveBeenCalledTimes(1)
    expect(String(warnings.mock.calls[0]?.[0])).toContain('EBUSY')
    // Backoff prevents immediate repeated Windows filesystem churn.
    expect(removeOrphanedManagedDirectory('critical-runtime', true)).toBe(false)
    expect(attempted).toEqual(['old-runtime', 'critical-runtime'])
  })

  it('does not prune runtime files while supervised updater is preparing a build', () => {
    const begin = supervisor.indexOf('async function waitForHostEvent(')
    const end = supervisor.indexOf('\nif (process.argv.includes(\'--cleanup-storage\'))', begin)
    expect(begin).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(begin)
    const loop = supervisor.slice(begin, end)
    expect(loop).toContain("readUpdateState()?.status !== 'preparing'")
    expect(loop).toContain('!watcherSupervisor?.isActive()')
    expect(supervisor).toContain('isActive() {')
    expect(supervisor).toContain('!stopping && watcher !== undefined && watcher.exitCode === null')
    expect(loop).toContain('cleanupObsoleteRuntimes()')
    // Capacity checks and explicit offline repairs must still report EBUSY.
    expect(supervisor).toContain('cleanupObsoleteRuntimes([runtimeRoot], { reportBusy: storageAtHardCap })')
    expect(supervisor).toContain('cleanupObsoleteRuntimes([], { reportBusy: true })')
  })

  it('backs off blocked Windows storage and avoids repeating EBUSY or capacity warnings in every poll', () => {
    expect(updater).toContain('const STORAGE_RETRY_MS = 5 * 60 * 1000')
    expect(updater).toContain('scripts/phoenix-windows-storage-repair.ps1 -Apply')
    expect(supervisor).toContain('scripts/phoenix-windows-storage-repair.ps1 -Apply')
    expect(updater).toContain('const STORAGE_WARNING_INTERVAL_MS = 15 * 60 * 1000')
    expect(updater).toContain('now - lastStorageWarningAt >= STORAGE_WARNING_INTERVAL_MS')
    expect(updater).toContain('blockedStorageTarget === inspection.target && Date.now() < nextStorageRetryAt')
    expect(updater).toContain('nextStorageRetryAt = Date.now() + STORAGE_RETRY_MS')
    expect(updater).toContain('blockedStorageTarget = undefined')
    expect(supervisor).toContain('const busyManagedRuntimeRetryAt = new Map()')
    expect(supervisor).toContain('BUSY_MANAGED_RUNTIME_RETRY_MS = 5 * 60 * 1000')
    expect(supervisor).toContain('busyManagedRuntimeRetryAt.set(key, Date.now() + BUSY_MANAGED_RUNTIME_RETRY_MS)')
    expect(supervisor).toContain('busyManagedRuntimeRetryAt.delete(key)')
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
