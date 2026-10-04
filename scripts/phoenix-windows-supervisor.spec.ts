import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')
const restartBridgeSource = readFileSync(resolve('scripts/phoenix-prepared-restart-bridge.mjs'), 'utf8')
const activatorSource = readFileSync(resolve('scripts/phoenix-activate-prepared.mjs'), 'utf8')
const cliSource = readFileSync(resolve('apps/cli/src/bin.ts'), 'utf8')
const updateWatchSource = readFileSync(resolve('apps/cli/src/phoenix-update-watch.ts'), 'utf8')
const autoUpdateSource = readFileSync(resolve('scripts/phoenix-auto-update.mjs'), 'utf8')
const acpPackage = JSON.parse(readFileSync(resolve('packages/examples/acp-demo/package.json'), 'utf8')) as { bin: Record<string, string> }
const jsonrpcPackage = JSON.parse(readFileSync(resolve('packages/examples/jsonrpc-demo/package.json'), 'utf8')) as { bin: Record<string, string> }

describe('PHOENIX Windows updater supervisor resilience', () => {
  it('retries failed updater watchers with capped backoff instead of a one-second hot loop', () => {
    expect(source).toContain('function superviseWatcher(host)')
    expect(source).toContain('WATCHER_MAX_RESTART_DELAY_MS')
    expect(source).toContain('WATCHER_STABLE_MS')
    expect(source).toContain('scheduleRestart(reason, launchedAt)')
    expect(source).toContain('restartDelay = Math.min(WATCHER_MAX_RESTART_DELAY_MS, restartDelay * 2)')
    expect(source).toContain('restartTimer.unref?.()')
  })

  it('respawns a watcher that exits while the Host is still alive, even with code 0', () => {
    expect(source).toContain("code === 0\n        ? 'unexpected clean exit'")
    expect(source).toContain('scheduleRestart(reason, launchedAt)')
    expect(source).not.toContain('leaving it stopped until the next Host launch')
  })

  it('disables watcher respawn before an intentional host/update shutdown', () => {
    expect(source).toContain('await watcherSupervisor.stop()')
    expect(source).toContain('stopping = true')
    expect(source).toContain('clearTimeout(restartTimer)')
  })

  it('does not start or respawn the updater watcher when update mode is off', () => {
    expect(source).toContain("const updateMode = (process.env.PHOENIX_UPDATE_MODE ?? 'auto').trim().toLowerCase()")
    expect(source).toContain("|| updateMode === 'off'")
  })

  it('injects a process-scoped Git safe.directory for the persistent Windows checkout', () => {
    expect(source).toContain("import { gitSafeDirectoryEnvironment } from './phoenix-git-safe-directory.mjs'")
    expect(source).toContain('Object.assign(process.env, gitSafeDirectoryEnvironment(process.env, [root]))')
    expect(autoUpdateSource).toContain("import { gitSafeDirectoryEnvironment } from './phoenix-git-safe-directory.mjs'")
    expect(autoUpdateSource).toContain("const env = bin === 'git'")
    expect(autoUpdateSource).toContain('gitSafeDirectoryEnvironment(process.env, [')
    expect(updateWatchSource).toContain("import { gitSafeDirectoryEnvironment } from '../../../scripts/phoenix-git-safe-directory.mjs'")
    expect(updateWatchSource).toContain('const safeEnv = gitSafeDirectoryEnvironment(process.env, [')
    expect(updateWatchSource).toContain('env: safeEnv')
  })

  it('uses only an exact clean verified staged activator for prepared self-updates', () => {
    expect(source).toContain('function preparedActivator()')
    expect(source).toContain("const stagedActivator = join(stage, 'scripts', 'phoenix-activate-prepared.mjs')")
    expect(source).toContain('target !== undefined')
    expect(source).toContain('sameRepository(stage)')
    expect(source).toContain('gitClean(stage)')
    expect(source).toContain("gitValue(stage, ['rev-parse', 'HEAD']) === target")
    expect(source).toContain('using the verified staged activator for prepared self-update compatibility')
  })

  it('uses the live activator when the prepared target needs managed realignment', () => {
    expect(source).toContain('function preparedTargetIsDivergent(target)')
    expect(source).toContain('&& !preparedTargetIsDivergent(target)')
  })

  it('does not reject a prepared source candidate merely because Host build output is absent', () => {
    const start = source.indexOf('function preparedStageForTarget')
    const end = source.indexOf('function compiledRuntimeEntrypoint', start)
    const preparedStageSource = source.slice(start, end)

    expect(preparedStageSource).toContain("join(stage, 'scripts', 'phoenix-activate-prepared.mjs')")
    expect(preparedStageSource).not.toContain("apps', 'cli', 'lib', 'bin.js")
  })

  it('invalidates a rejected prepared marker so the restart bridge cannot loop forever', () => {
    expect(source).toContain('clearPreparedRecord()')
    expect(source).toContain('invalidated the cached candidate')
    expect(source).not.toContain('prepared update no longer matches a verified staging candidate; refusing live activation')
  })

  it('uses the same repository-scoped staging directory in the activator and supervisor', () => {
    expect(source).toContain('phoenix-stage-${stageIdentity()}')
    expect(activatorSource).toContain("import { createHash } from 'node:crypto'")
    expect(activatorSource).toContain('function stageIdentity(root)')
    expect(activatorSource).toContain('phoenix-stage-${stageIdentity(root)}')
    expect(activatorSource).toContain('const stage = stageDirectory(root)')
    expect(activatorSource).not.toContain("return join(base, 'phoenix-stage')")
  })

  it('invalidates a candidate after any non-critical activation failure instead of retrying it forever', () => {
    const start = source.indexOf('const activationCode = activatePrepared()')
    const end = source.indexOf('runtimeRoot = root', start)
    const failurePath = source.slice(start, end)

    expect(failurePath).toContain('clearPreparedRecord()')
    expect(failurePath).toContain('invalidated the prepared candidate')
    expect(failurePath).not.toContain('The prepared update remains available to retry')
  })

  it('reconciles stale runtime and client artifacts before the Windows supervisor starts', () => {
    expect(cliSource).toContain("import { preparePhoenixWebRuntime } from './phoenix-runtime-freshness.ts'")
    expect(cliSource).toContain('preparePhoenixWebRuntime(runtimeSourceRoot)')
    expect(cliSource).toContain("const runtimeSourceRoot = resolve(supervisor, '..', '..')")
  })

  it('consumes duplicate activation requests when the requested SHA is already active', () => {
    expect(source).toContain('function readActiveRuntimeRecord()')
    expect(source).toContain('function healthyRuntimeForTarget(target)')
    expect(source).toContain('is already active and healthy; reusing it without rebuilding')
    expect(source).toContain('ignored stale activation request')
    expect(source).toContain('consumed duplicate post-exit activation request')
    expect(source).toContain('clearRestartRequest()')
    expect(source).toContain('clearPreparedRecord()')
  })

  it('keeps the current Host online until the replacement runtime is fully prewarmed', () => {
    expect(source).toContain('warming replacement runtime while current Host remains online')
    expect(source).toContain('const runtime = activatePreparedRuntime(updateTarget)')
    expect(source).toContain("kind: 'safe-update-handoff'")
    expect(source).toContain('replacement runtime is fully ready; handing off from the current Host')

    const warm = source.indexOf('warming replacement runtime while current Host remains online')
    const kill = source.indexOf('if (host.exitCode === null) host.kill()', warm)
    expect(warm).toBeGreaterThan(-1)
    expect(kill).toBeGreaterThan(warm)
  })

  it('does not let the prepared bridge request a Host shutdown for supervised updates', () => {
    expect(restartBridgeSource).toContain('writeJsonAtomic(join(controlDir, UPDATE_RESTART_FILE)')
    expect(restartBridgeSource).not.toContain('writeJsonAtomic(join(controlDir, HOST_RESTART_FILE)')
    expect(restartBridgeSource).not.toContain("const HOST_RESTART_FILE = 'phoenix-host-restart-request.json'")
  })

  it('routes dirty live checkouts through the verified isolated runtime', () => {
    expect(source).toContain('const liveStatus = gitStatus(root)')
    expect(source).toContain('liveStatus.entries.length > 0')
    expect(source).toContain('activatePreparedRuntime(requestedTarget)')
    expect(source).toContain('the live checkout will not be modified')
  })

  it('routes clean development branches through the isolated runtime without moving the source branch', () => {
    expect(source).toContain("import { isManagedReleaseBranch } from './phoenix-update-policy.mjs'")
    expect(source).toContain("const liveBranch = gitValue(root, ['branch', '--show-current'])")
    expect(source).toContain('!isManagedReleaseBranch(liveBranch, STABLE_SOURCE_BRANCH)')
    expect(source).toContain('development branch')
    expect(source).toContain('activatePreparedRuntime(requestedTarget)')
  })

  it('keeps workspace bin targets present before the isolated runtime build', () => {
    const bins = [
      ['packages/examples/acp-demo', acpPackage.bin['dsh-acp-demo']],
      ['packages/examples/jsonrpc-demo', jsonrpcPackage.bin['dsh-jsonrpc-agent']],
    ] as const

    for (const [packageRoot, bin] of bins) {
      expect(bin).toBeDefined()
      expect(bin?.startsWith('lib/')).toBe(false)
      expect(existsSync(resolve(packageRoot, bin ?? ''))).toBe(true)
    }
  })

  it('passes the active runtime root to the stable watcher so isolated updates do not loop forever', () => {
    expect(source).toContain('PHOENIX_RUNTIME_ROOT: runtimeRoot')
  })

  it('hydrates the current user Google token before launching each Host', () => {
    expect(source).toContain("import { hydratePhoenixEnvironment } from './phoenix-windows-environment.mjs'")
    expect(source).toContain('...hydratePhoenixEnvironment(process.env)')
  })

  it('routes direct Windows web launches through the supervisor so restart survives the host exit', () => {
    expect(cliSource).toContain("process.platform === 'win32'")
    expect(cliSource).toContain("rawArgs[0] === 'web'")
    expect(cliSource).toContain("process.env.PHOENIX_UPDATE_SUPERVISED !== '1'")
    expect(cliSource).toContain('phoenix-windows-supervisor.mjs')
    expect(cliSource).toContain('process.exit(result.status ?? 1)')
  })

  it('keeps the supervisor alive and relaunches a host that exits unexpectedly', () => {
    expect(source).toContain('HOST_RESTART_DELAY_MS')
    expect(source).toContain('shutdownRequested')
    expect(source).toContain('host exited unexpectedly')
    expect(source).toContain('await sleep(HOST_RESTART_DELAY_MS)')
    expect(source).toContain('continue')
  })

  it('repairs missing compiled profile artifacts once and refuses an endless restart loop if repair fails', () => {
    expect(source).toContain('function profileFallbackHasMissingRuntimeArtifact()')
    expect(source).toContain('function isMissingProfileRuntimeArtifact(detail)')
    expect(source).toContain("normalized.includes('/profiles/node_modules/')")
    expect(source).toContain("['run', 'build:lib:host']")
    expect(source).toContain('repairMissingProfileRuntimeArtifact(runtimeRoot, crashPreflight)')
    expect(source).toContain('profile artifact repair failed; refusing an automatic relaunch loop')
  })

  it('distinguishes Ctrl-C/termination from a model or host crash', () => {
    expect(source).toContain("process.once('SIGINT', requestShutdown)")
    expect(source).toContain("process.once('SIGTERM', requestShutdown)")
    expect(source).toContain('if (shutdownRequested)')
  })

  it('preflights changed configuration while the old host is still available', () => {
    expect(source).toContain('preflightBootConfiguration')
    expect(source).toContain('PHOENIX_CONFIG_PREFLIGHT')
    expect(source).toContain('configuration preflight failed; keeping the current PHOENIX host alive')
  })

  it('restores last-known-good configuration after an early boot crash', () => {
    expect(source).toContain('persistLastKnownGoodConfiguration')
    expect(source).toContain('restoreLastKnownGoodConfiguration')
    expect(source).toContain('configuration changed since the last healthy boot')
    expect(source).toContain('restored last-known-good configuration')
  })
  it('boot-preflights isolated runtimes before activation or restoration', () => {
    expect(source).toContain('function runtimeBootPreflight(path)')
    expect(source).toContain("web', '--dump-config'")
    expect(source).toContain('const bootPreflight = runtimeBootPreflight(runtime)')
    expect(source).toContain('const bootPreflight = runtimeBootPreflight(candidate)')
    expect(source).toContain('failed boot preflight')
    expect(source).toContain('retired isolated runtime')
  })

  it('never restores an isolated runtime that is older than the durable checkout HEAD', () => {
    const start = source.indexOf('function activeRuntimeIsSupersededByLiveCheckout(target)')
    const end = source.indexOf('function restoreActiveRuntime()', start)
    const supersededRule = source.slice(start, end)

    expect(supersededRule).toContain("const liveHead = gitValue(root, ['rev-parse', 'HEAD'])")
    expect(supersededRule).toContain("['merge-base', '--is-ancestor', target, liveHead]")
    expect(supersededRule).not.toContain('gitStatus(root)')
    expect(supersededRule).not.toContain("['branch', '--show-current']")
    expect(supersededRule).not.toContain('isManagedReleaseBranch')
    expect(source).toContain('activeRuntimeIsSupersededByLiveCheckout(value.target)')
    expect(source).toContain('retired stale isolated runtime')
    expect(source).toContain('durable checkout is newer')
  })

  it('retires an isolated runtime after any unexpected Host exit instead of relaunching it forever', () => {
    expect(source).toContain('if (runtimeRoot !== root)')
    expect(source).toContain('const failedRuntime = runtimeRoot')
    expect(source).toContain('runtimeRoot = root')
    expect(source).toContain('clearActiveRuntime()')
    expect(source).toContain('instead of relaunching a broken update')
  })

  it('garbage-collects obsolete isolated runtimes without deleting the active runtime', () => {
    expect(source).toContain('function runtimeDirectoriesForCleanup()')
    expect(source).toContain('function cleanupObsoleteRuntimes(extraKeep = [])')
    expect(source).toContain('const active = readActiveRuntimeRecord()')
    expect(source).toContain('keep.add(runtimePathKey(active.path))')
    expect(source).toContain('const inheritedRuntimeRoot = process.env.PHOENIX_RUNTIME_ROOT?.trim()')
    expect(source).toContain('if (runtimeProtectedByOwningCheckout(candidate)) continue')
    expect(source).toContain('if (managedDirectoryAgeMs(candidate) < UPDATE_STORAGE_RETENTION_MS) continue')
    expect(source).toContain("spawnSync('git', ['worktree', 'remove', '--force', path]")
    expect(source).toContain("spawnSync('git', ['worktree', 'prune', '--expire', 'now']")
    expect(source).toContain('removed obsolete isolated runtime')
    expect(source).toContain('storage cleanup removed')
  })

  it('keeps this checkout persistent updater stage and protects live preparations', () => {
    expect(source).toContain('function stageDirectoriesForCleanup()')
    expect(source).toContain('function stageProtectedByOwningCheckout(path)')
    expect(source).toContain('const marker = join(common, PREPARED_FILE)')
    expect(source).toContain('const statePath = join(common, UPDATE_STATE_FILE)')
    expect(source).toContain('state?.status === \'preparing\'')
    expect(source).toContain('/^[0-9a-f]{40}$/iu.test(state.target)')
    expect(source).toContain('if (key === currentStage) continue')
    expect(source).toContain('if (stageProtectedByOwningCheckout(candidate)) continue')
    expect(source).toContain('if (managedDirectoryAgeMs(candidate) < STAGE_STORAGE_RETENTION_MS) continue')
    expect(source).toContain('removed stale updater staging worktree')
  })

  it('defers Windows worktree cleanup instead of recursively deleting a busy tree', () => {
    expect(source).toContain("spawnSync('git', ['worktree', 'remove', '--force', path]")
    expect(source).toContain('if (result.status === 0 || !existsSync(path)) return true')
    expect(source).toContain('deferred managed worktree cleanup while it is still in use')
    expect(source).not.toContain('rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 })')
  })

  it('repairs an incompletely materialized updater stage before running the build', () => {
    expect(autoUpdateSource).toContain('function missingTrackedFiles(stage, limit = 32)')
    expect(autoUpdateSource).toContain('function ensureStagingMaterialized(stage, target)')
    expect(autoUpdateSource).toContain("['sparse-checkout', 'disable']")
    expect(autoUpdateSource).toContain("['reset', '--hard', target]")
    expect(autoUpdateSource).toContain('ensureStagingMaterialized(stage, target)')
    expect(autoUpdateSource).toContain('staging worktree remains incomplete after repair')
  })

  it('offers a cleanup-only supervisor mode and invokes it from each new Windows Host', () => {
    expect(source).toContain("if (process.argv.includes('--cleanup-storage'))")
    expect(source).toContain('recoverStaleStagingIndexLock()')
    expect(source).toContain('cleanupObsoleteRuntimes()')
    expect(updateWatchSource).toContain('const installRoot = process.env.PHOENIX_INSTALL_ROOT?.trim()')
    expect(updateWatchSource).toContain("startWatcher(root, supervisor, 'PHOENIX STORAGE', ['--cleanup-storage'])")
  })

  it('runs runtime garbage collection at startup and after safe runtime handoff paths', () => {
    expect(source).toContain('restoreActiveRuntime()\ncleanupObsoleteRuntimes()')
    expect(source).toContain("if (hostEvent.kind === 'safe-update-handoff') cleanupObsoleteRuntimes()")
    expect(source).toContain('clearActiveRuntime()\n    cleanupObsoleteRuntimes()')
  })

})
