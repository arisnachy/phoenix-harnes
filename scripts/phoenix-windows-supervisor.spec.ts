import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
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
  it('reserves a crash-safe exclusive Windows named pipe before starting a second Host', () => {
    expect(source).toContain("import { createServer } from 'node:net'")
    expect(source).toContain('function supervisorPipeName()')
    expect(source).toContain("createHash('sha256').update(lockScope)")
    expect(source).toContain('const portArgIndex = hostArgs.indexOf(\'--port\')')
    expect(source).toContain('web-port:')
    expect(source).toContain("if (error?.code === 'EADDRINUSE')")
    expect(source).toContain('let supervisorInstanceLock = await acquireSupervisorInstance()')
    expect(source).toContain('if (supervisorInstanceLock === null) {')
    expect(source).toContain('retireVerifiedOlderPhoenixHost(port)')
    expect(source).toContain('waitForHostPortRelease(port)')
    expect(source).toContain("const script = join(supervisorSourceRoot, 'scripts', 'phoenix-windows-stale-host-takeover.ps1')")
    expect(source).toContain('PHOENIX_STALE_HOST_RETIRED')
    expect(source.indexOf('let supervisorInstanceLock = await acquireSupervisorInstance()')).toBeLessThan(
      source.indexOf('recoverStaleStagingIndexLock()\nrestoreActiveRuntime()'),
    )
    expect(source).toContain('supervisorInstanceLock?.close()')
  })

  it('retires only a proven older Windows Phoenix checkout, never an arbitrary port owner', () => {
    const script = readFileSync(resolve('scripts/phoenix-windows-stale-host-takeover.ps1'), 'utf8')
    expect(script).toContain('Get-NetTCPConnection -State Listen -LocalPort $Port')
    expect(script).toContain('Test-OfficialCheckout $Root')
    expect(script).toContain('Test-OfficialCheckout $oldRoot')
    expect(script).toContain('Test-CheckoutOwnedRuntime $oldRoot $newRoot')
    expect(script).toContain('Get-InstalledPhoenixDesktop $hostProcess')
    expect(script).toContain('merge-base --is-ancestor $oldHead $newHead')
    expect(script).toContain('GetOwner')
    expect(script).toContain('Stop-Process -Id $supervisorPid -Force')
    expect(script).toContain('Stop-Process -Id $listenerPid -Force')
    expect(script).toContain('PHOENIX_STALE_HOST_RETIRED')
    expect(source).toContain('if (!migrated)')
  })

  it('requires explicit approval and rechecks PID identity when repairing a stranded local Host', () => {
    const repair = readFileSync(resolve('scripts/phoenix-windows-port-repair.ps1'), 'utf8')
    expect(repair).toContain('[switch]$Apply')
    expect(repair).toContain('if (-not $Apply)')
    expect(repair).toContain('Get-NetTCPConnection -State Listen -LocalPort $ListenPort')
    expect(repair).toContain('Get-OwnerIsCurrentUser $hostProcess')
    expect(repair).toContain('$liveHost.CreationDate -ne $hostProcess.CreationDate')
    expect(repair).toContain('Stop-Process -Id ([int]$supervisor.ProcessId) -Force')
    expect(repair).toContain('Stop-Process -Id $hostPid -Force')
    expect(repair).toContain('El listener no es un Host Phoenix propio verificable')
  })

  it('retries failed updater watchers with capped backoff instead of a one-second hot loop', () => {
    expect(source).toContain('function superviseWatcher()')
    expect(source).toContain('WATCHER_MAX_RESTART_DELAY_MS')
    expect(source).toContain('WATCHER_STABLE_MS')
    expect(source).toContain('scheduleRestart(reason, launchedAt)')
    expect(source).toContain('restartDelay = Math.min(WATCHER_MAX_RESTART_DELAY_MS, restartDelay * 2)')
    expect(source).toContain('restartTimer.unref?.()')
  })

  it('keeps the updater watcher alive across unexpected Host crashes', () => {
    expect(source).toContain('function superviseWatcher()')
    expect(source).toContain('if (stopping || shutdownRequested || restartTimer !== undefined) return')
    expect(source).toContain('if (stopping || shutdownRequested) return')
    expect(source).not.toContain('host.exitCode !== null || host.killed')
    expect(source).toContain('let watcherSupervisor')
    expect(source).toContain('if (watcherSupervisor === undefined) watcherSupervisor = superviseWatcher()')
    expect(source).toContain('async function stopWatcherSupervisor()')
    expect(source).toContain('const supervisor = watcherSupervisor')
    expect(source).toContain('watcherSupervisor = undefined')
    expect(source).toContain('if (supervisor !== undefined) await supervisor.stop()')
    expect(source).toContain('const requestedTarget = restartRequestTarget()')
    expect(source).toContain('if (requestedTarget !== undefined) {\n    await stopWatcherSupervisor()')
    expect(source).toContain('await stopWatcherSupervisor()')
  })

  it('respawns a watcher that exits while the Host is still alive, even with code 0', () => {
    expect(source).toContain("code === 0\n        ? 'unexpected clean exit'")
    expect(source).toContain('scheduleRestart(reason, launchedAt)')
    expect(source).not.toContain('leaving it stopped until the next Host launch')
  })

  it('disables watcher respawn before an intentional host/update shutdown', () => {
    expect(source).toContain('await stopWatcherSupervisor()')
    expect(source).toContain('stopping = true')
    expect(source).toContain('clearTimeout(restartTimer)')
  })

  it('does not start or respawn the updater watcher when update mode is off', () => {
    expect(source).toContain("const updateMode = (process.env.PHOENIX_UPDATE_MODE ?? 'auto').trim().toLowerCase()")
    expect(source).toContain("|| updateMode === 'off'")
  })

  it('persists the exact Windows checkout as safe for user Git commands only for the official remote', () => {
    expect(source).toContain("import { gitSafeDirectoryEnvironment, persistGitSafeDirectory } from './phoenix-git-safe-directory.mjs'")
    expect(source).toContain("normalized === 'https://github.com/arisnachy/phoenix-harnes'")
    expect(source).toContain("normalized === 'git@github.com:arisnachy/phoenix-harnes'")
    expect(source).not.toContain("normalized.endsWith('github.com/arisnachy/phoenix-harnes')")
    expect(source).toContain('persistGitSafeDirectory(root)')
  })

  it('injects a process-scoped Git safe.directory for the persistent Windows checkout', () => {
    expect(source).toContain("import { gitSafeDirectoryEnvironment, persistGitSafeDirectory } from './phoenix-git-safe-directory.mjs'")
    expect(source).toContain('Object.assign(process.env, gitSafeDirectoryEnvironment(process.env, [root]))')
    expect(autoUpdateSource).toContain("import { gitSafeDirectoryEnvironment } from './phoenix-git-safe-directory.mjs'")
    expect(autoUpdateSource).toContain("const env = bin === 'git'")
    expect(autoUpdateSource).toContain('gitSafeDirectoryEnvironment(process.env, [')
    expect(updateWatchSource).toContain("import { gitSafeDirectoryEnvironment } from '../../../scripts/phoenix-git-safe-directory.mjs'")
    expect(updateWatchSource).toContain('const safeEnv = gitSafeDirectoryEnvironment(process.env, [')
    expect(updateWatchSource).toContain('env: safeEnv')
  })

  it('uses the same code generation for the supervisor and its fallback activator', () => {
    expect(source).toContain("import { fileURLToPath } from 'node:url'")
    expect(source).toContain("const supervisorSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')")
    expect(source).toContain("const liveActivator = join(supervisorSourceRoot, 'scripts', 'phoenix-activate-prepared.mjs')")
    expect(cliSource).toContain('phoenixSupervisorSourceRoot(runtimeSourceRoot)')
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
    expect(cliSource).toContain('phoenixSupervisorSourceRoot, preparePhoenixWebRuntime')
    expect(cliSource).toContain('preparePhoenixWebRuntime(runtimeSourceRoot)')
    expect(cliSource).toContain("const runtimeSourceRoot = resolve(durableSupervisor, '..', '..')")
    expect(cliSource).toContain('const supervisorSourceRoot = phoenixSupervisorSourceRoot(runtimeSourceRoot)')
    expect(cliSource).toContain("const supervisor = resolve(supervisorSourceRoot, 'scripts', 'phoenix-windows-supervisor.mjs')")
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

  it('ignores updater-owned Host restart markers for the already-active verified runtime', () => {
    expect(source).toContain('function readHostRestartRequest()')
    expect(source).toContain('function activeRuntimeForUpdaterHostRestart(request, hostRuntimeRoot)')
    expect(source).toContain("request?.source !== 'updater-ready-state'")
    expect(source).toContain('ignored stale Host restart request')
    expect(source).toContain('if (readPreparedRecord()?.target === alreadyActive.target) clearPreparedRecord()')
    expect(source).toContain('if (restartRequestTarget() === alreadyActive.target) clearRestartRequest()')
    expect(source).toContain('clearHostRestartRequest()')
    expect(restartBridgeSource).toContain("join(controlDir, 'phoenix-host-restart-request.json')")
    expect(restartBridgeSource).toContain("value.source === 'updater-ready-state'")
  })

  it('does not mistake a prewarmed runtime for the running Host and reports a failed health checkpoint', () => {
    expect(source).toContain('function confirmActiveRuntimeHealth()')
    expect(source).toContain('confirmActiveRuntimeHealth()')
    expect(source).toContain('healthyAt: new Date().toISOString()')
    expect(source).toContain('const hostRuntimeRoot = runtimeRoot')
    expect(source).toContain('runtimePathKey(alreadyActive.path) === runtimePathKey(hostRuntimeRoot)')
    expect(source).toContain('runtimePathKey(active.path) !== runtimePathKey(hostRuntimeRoot)')
    expect(source).toContain("recordPhoenixUpdateStep(stateFile, 'health-check', 'failed'")
    expect(source).toContain("phase: 'health-check'")
    expect(source).toContain('The new Host exited before its healthy startup checkpoint')
  })

  it('prevents restart loops when a configured Windows port is already occupied', () => {
    expect(source).toContain("const hostIndex = hostArgs.indexOf('--host')")
    expect(source).toContain("host !== '127.0.0.1' && host !== 'localhost'")
    expect(source).toContain("const portIndex = hostArgs.indexOf('--port')")
    expect(source).toContain("hostArgs.find(arg => arg.startsWith('--port='))")
    expect(source).toContain('?? process.env.PHOENIX_PORT')
    expect(source).toContain('?? process.env.PORT')
    expect(source).toContain("?? '3080'")
    expect(source).toContain('Number.isInteger(port) && port > 0 && port <= 65535')
    expect(source).toContain('if (port !== undefined && await existingHostOnPort(port))')
    expect(source).toContain('const migrated = retireVerifiedOlderPhoenixHost(port)')
    expect(source).toContain('if (!migrated) {')
    expect(source).toContain('está ocupado; no se cerrará un proceso no verificado')
    expect(source).toContain('phoenix-windows-port-repair.ps1')
  })

  it('checks actual TCP bind availability and waits after a Windows Host handoff', () => {
    expect(source).toContain('function existingHostOnPort(port)')
    expect(source).toContain("probe.listen({ host: '127.0.0.1', port, exclusive: true }")
    expect(source).toContain('probe.close(() => { finish(false) })')
    expect(source).not.toContain("createConnection({ host: '127.0.0.1', port })")
    expect(source).toContain('async function waitForHostPortRelease(port, timeoutMs = HOST_PORT_RELEASE_WAIT_MS)')
    expect(source).toContain('const released = await waitForHostPortRelease(handoffPort)')
    expect(source).toContain('if (!released && !shutdownRequested)')
    expect(source).toContain('Host handoff blocked:')
    const wait = source.indexOf('const released = await waitForHostPortRelease(handoffPort)')
    const nextLaunch = source.indexOf('const host = startHost()', wait)
    expect(wait).toBeGreaterThan(-1)
    expect(nextLaunch).toBe(-1) // next launch occurs at the top of the following loop, after this guard
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

  it('waits for a preparing stable and activates it without a Host-side bridge after a crash', () => {
    expect(source).toContain('function readUpdateState()')
    expect(source).toContain('async function waitForPreparedUpdateAfterHostCrash()')
    expect(source).toContain("state?.status !== 'preparing'")
    expect(source).toContain('Host exited while a stable update is still preparing')
    expect(source).toContain('crashPreparedUpdate = await waitForPreparedUpdateAfterHostCrash()')
    expect(source).toContain('await stopWatcherSupervisor()')
    expect(source).toContain('activatePreparedRuntime(crashPreparedUpdate.target)')
    expect(source).toContain('without waiting for a Host-side restart bridge')
    expect(source).toContain('relaunching PHOENIX from the verified runtime')
  })

  it('never downgrades a newer durable checkout to an older prepared stable during crash recovery', () => {
    const activateStart = source.indexOf('function activatePreparedRuntime(target)')
    const activeStart = source.indexOf('function activeRuntimeIsSupersededByLiveCheckout(target)')
    expect(activateStart).toBeGreaterThan(0)
    expect(activeStart).toBeGreaterThan(activateStart)
    const activate = source.slice(activateStart, activeStart)
    expect(activate).toContain('if (activeRuntimeIsSupersededByLiveCheckout(target))')
    expect(activate).toContain('refusing an automatic downgrade during Host recovery')
    expect(activate.indexOf('if (activeRuntimeIsSupersededByLiveCheckout(target))')).toBeLessThan(
      activate.indexOf('const alreadyActive = healthyRuntimeForTarget(target)'),
    )
  })

  it('waits for port release after a crash before activating a recovered stable Host', () => {
    const start = source.indexOf('// A crashed Host can leave its HTTP socket')
    const recovery = source.indexOf('if (crashPreparedUpdate !== undefined)')
    expect(start).toBeGreaterThan(0)
    expect(recovery).toBeGreaterThan(start)
    const handoff = source.slice(start, recovery)
    expect(handoff).toContain('if (!shutdownRequested)')
    expect(handoff).toContain('await existingHostOnPort(handoffPort)')
    expect(handoff).toContain('await waitForHostPortRelease(handoffPort)')
    expect(handoff).toContain("plannedHostRestart ? 'planned handoff' : 'unexpected Host exit'")
    expect(handoff).toContain("writeConfigurationRecoveryReport('post-exit-port-remains-occupied', detail)")
    expect(handoff).toContain('finalCode = 1')
    expect(handoff).not.toContain('if (plannedHostRestart && !shutdownRequested)')
    expect(handoff.indexOf('await waitForHostPortRelease(handoffPort)')).toBeLessThan(
      handoff.indexOf('finalCode = 1'),
    )
  })

  it('repairs missing compiled profile artifacts even when dump-config does not load the broken plugin', () => {
    expect(source).toContain('function profileFallbackHasMissingRuntimeArtifact()')
    expect(source).toContain('PROFILE_REQUIRED_RUNTIME_PACKAGES')
    expect(source).toContain("'@phoenix-ai/dsh-mcp-client'")
    expect(source).toContain("'@phoenix-ai/dsh-mcp-connector-registry'")
    expect(source).toContain("'@phoenix-ai/dsh-authorization'")
    expect(source).toContain("'@phoenix-ai/dsh-tool-google-workspace'")
    expect(source).toContain('if (!existsSync(modulesDir) || !existsSync(scopeDir)) return true')
    expect(source).toContain('for (const packageName of PROFILE_REQUIRED_RUNTIME_PACKAGES)')
    expect(source).toContain('if (!existsSync(manifestPath)) continue')
    expect(source).toContain('function isMissingProfileRuntimeArtifact(detail)')
    expect(source).toContain("normalized.includes('/profiles/node_modules/')")
    expect(source).toContain('const startupFallbackMissing = profileFallbackHasMissingRuntimeArtifact()')
    expect(source).toContain('repairMissingProfileRuntimeArtifact(runtimeRoot, startupPreflight, startupFallbackMissing)')
    expect(source).toContain('const crashFallbackMissing = profileFallbackHasMissingRuntimeArtifact()')
    expect(source).toContain('repairMissingProfileRuntimeArtifact(runtimeRoot, crashPreflight, crashFallbackMissing)')
    expect(source).toContain("['exec', 'tsx', 'scripts/build.ts']")
    expect(source).toContain('const retried = runtimeBootPreflight(path, { refresh: true })')
    expect(source).toContain('const fallbackStillMissing = profileFallbackHasMissingRuntimeArtifact()')
    expect(source.indexOf('const retried = runtimeBootPreflight(path, { refresh: true })'))
      .toBeLessThan(source.indexOf('const fallbackStillMissing = profileFallbackHasMissingRuntimeArtifact()'))
    expect(source).not.toContain('] as const')
    expect(source).toContain('a linked package still lacks its declared main artifact')
    expect(source).toContain('profile artifact repair failed; refusing an automatic relaunch loop')
  })

  it('does not rebuild the runtime when dump-config has already healed missing profile links', () => {
    const start = source.indexOf('function repairMissingProfileRuntimeArtifact(')
    const end = source.indexOf('\nfunction writeActiveRuntime(', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    let stillMissing = false
    let rebuilds = 0
    const context = {
      profileFallbackHasMissingRuntimeArtifact: () => stillMissing,
      isMissingProfileRuntimeArtifact: () => false,
      runPnpm: () => { rebuilds += 1; stillMissing = false },
      runtimeBootPreflight: () => ({ ok: true, detail: '' }),
      console: { error: () => undefined },
    }
    const repair = runInNewContext(
      source.slice(start, end) + '\nrepairMissingProfileRuntimeArtifact',
      context,
    ) as (path: string, preflight: { ok: boolean; detail: string }, fallbackMissing: boolean) => { ok: boolean }
    expect(repair('C:/phoenix', { ok: true, detail: '' }, true).ok).toBe(true)
    expect(rebuilds).toBe(0)

    // When the link really is still absent, retain the repair-and-recheck path.
    stillMissing = true
    expect(repair('C:/phoenix', { ok: true, detail: '' }, true).ok).toBe(true)
    expect(rebuilds).toBe(1)
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

  it('reuses only a checkpoint for the same compiled runtime, Node version, and configuration', () => {
    const start = source.indexOf('function verifiedHealthyStartupCheckpoint(path = runtimeRoot)')
    const end = source.indexOf('\nfunction recoverConfigurationBeforeFirstBoot()', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)

    const checkpoint = {
      runtimePath: 'c:/phoenix',
      runtimeHead: 'current-head',
      fingerprint: 'current-config',
      nodeVersion: 'v24',
    }
    const context = {
      checkpoint,
      runtimeRoot: 'C:/Phoenix',
      process: { version: 'v24' },
      readLastKnownGoodConfiguration: () => context.checkpoint,
      runtimePathKey: () => 'c:/phoenix',
      gitValue: () => 'current-head',
      configurationFingerprint: () => 'current-config',
      captureBootCriticalConfiguration: () => ({}),
      compiledRuntimeEntrypoint: () => 'bin.js',
      profileFallbackHasMissingRuntimeArtifact: () => false,
    }
    const rule = runInNewContext(
      source.slice(start, end) + '\nverifiedHealthyStartupCheckpoint',
      context,
    ) as () => boolean
    expect(rule()).toBe(true)
    context.checkpoint = { ...checkpoint, fingerprint: 'changed-config' }
    expect(rule()).toBe(false)
    context.checkpoint = { ...checkpoint, runtimeHead: 'old-head' }
    expect(rule()).toBe(false)
    context.checkpoint = { ...checkpoint, nodeVersion: 'v22' }
    expect(rule()).toBe(false)
    context.checkpoint = checkpoint
    context.profileFallbackHasMissingRuntimeArtifact = () => true
    expect(rule()).toBe(false)
  })

  it('does not repeat successful dump-config probes or reuse them after a rebuild', () => {
    expect(source).toContain('let lastSuccessfulBootPreflight')
    expect(source).toContain('const key = `${runtimePathKey(path)}:${currentHead')
    expect(source).toContain('if (!refresh && lastSuccessfulBootPreflight?.key === key)')
    expect(source).toContain('lastSuccessfulBootPreflight = preflight.ok ? { key, result: preflight } : undefined')
    expect(source).toContain('runtimeBootPreflight(path, { refresh: true })')
  })

  it('restores last-known-good configuration after an early boot crash', () => {
    expect(source).toContain('persistLastKnownGoodConfiguration')
    expect(source).toContain('restoreLastKnownGoodConfiguration')
    expect(source).toContain('configuration changed since the last healthy boot')
    expect(source).toContain('restored last-known-good configuration')
  })
  it('boot-preflights isolated runtimes before activation or restoration', () => {
    expect(source).toContain('function runtimeBootPreflight(path, { refresh = false } = {})')
    expect(source).toContain("web', '--dump-config'")
    expect(source).toContain('const bootPreflight = runtimeBootPreflight(runtime)')
    expect(source).toContain('const bootPreflight = verifiedHealthyStartupCheckpoint(candidate)')
    expect(source).toContain(': runtimeBootPreflight(candidate)')
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

  it('caps obsolete isolated runtimes without deleting the active runtime', () => {
    expect(source).toContain('function runtimeDirectoriesForCleanup()')
    expect(source).toContain('function cleanupObsoleteRuntimes(extraKeep = [], { reportBusy = false } = {})')
    expect(source).toContain('const active = readActiveRuntimeRecord()')
    expect(source).toContain('keep.add(runtimePathKey(active.path))')
    expect(source).toContain('const inheritedRuntimeRoot = process.env.PHOENIX_RUNTIME_ROOT?.trim()')
    expect(source).toContain("process.env.PHOENIX_UPDATE_RUNTIME_BACKUPS ?? ''")
    expect(source).toContain('MAX_INACTIVE_RUNTIME_BACKUPS')
    expect(source).toContain('const inactiveRuntimes = runtimeDirectoriesForCleanup()')
    expect(source).toContain('!keep.has(key) && !runtimeProtectedByOwningCheckout(candidate)')
    expect(source).toContain('.sort((left, right) => managedDirectoryMtimeMs(right) - managedDirectoryMtimeMs(left))')
    expect(source).toContain('if (retainedInactiveRuntimes < MAX_INACTIVE_RUNTIME_BACKUPS)')
    expect(source).not.toContain('if (managedDirectoryAgeMs(candidate) < UPDATE_STORAGE_RETENTION_MS) continue')
    expect(source).toContain("spawnSync('git', ['-c', 'core.longpaths=true', 'worktree', 'remove', '--force', path]")
    expect(source).toContain("spawnSync('git', ['worktree', 'prune', '--expire', 'now']")
    expect(source).toContain('removed obsolete isolated runtime')
    expect(source).toContain('inactive runtime backups kept')
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

  it('distinguishes registered worktrees from orphaned runtime directories during cleanup', () => {
    expect(source).toContain("spawnSync('git', ['worktree', 'list', '--porcelain']")
    expect(source).toContain('function removeOrphanedManagedDirectory(path, reportBusy = false)')
    expect(source).toContain('rmSync(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 250 })')
    expect(source).toContain("spawnSync('git', ['-c', 'core.longpaths=true', 'worktree', 'remove', '--force', path]")
    expect(source).toContain('const refreshedWorktrees = registeredWorktreePaths()')
    expect(source).toContain('const becameOrphaned = /(?:is )?not a working tree/iu.test(detail)')
    expect(source).toContain('registered managed worktree cleanup deferred because it is still in use')
    expect(source).toContain('orphaned managed runtime is no longer a Git worktree but Windows still has it open')
  })

  it('repairs an incompletely materialized updater stage before running the build', () => {
    expect(autoUpdateSource).toContain('function missingTrackedFiles(stage, limit = 32)')
    expect(autoUpdateSource).toContain('function ensureStagingMaterialized(stage, target)')
    expect(autoUpdateSource).toContain("['sparse-checkout', 'disable']")
    expect(autoUpdateSource).toContain("['reset', '--hard', target]")
    expect(autoUpdateSource).toContain('ensureStagingMaterialized(stage, target)')
    expect(autoUpdateSource).toContain('staging worktree remains incomplete after repair')
  })

  it('only permits in-place fallback for an eligible, clean, fast-forward release', () => {
    const begin = source.indexOf('function safeInPlacePreparedFallback(target)')
    const end = source.indexOf('\nfunction preparedActivator()', begin)
    expect(begin).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(begin)
    const routine = source.slice(begin, end)
    expect(routine).toContain('runtimeRoot !== root')
    expect(routine).toContain('readActiveRuntimeRecord() !== undefined')
    expect(routine).toContain('gitClean(root)')
    expect(routine).toContain('isManagedReleaseBranch(branch, STABLE_SOURCE_BRANCH)')
    expect(routine).toContain("gitSucceeds(root, ['merge-base', '--is-ancestor', current, target])")
    expect(routine).toContain('preparedStageForTarget(target) !== undefined')
    expect(source).toContain('runtimeDirectoriesForCleanup().length >= MAX_RUNTIME_DIRECTORIES')
    expect(source).toContain("kind: 'safe-inplace-update-handoff'")
    expect(source).toContain("hostEvent.kind === 'safe-inplace-update-handoff'")
  })

  it('exercises the clean-release fallback eligibility without touching real worktrees', () => {
    const begin = source.indexOf('function safeInPlacePreparedFallback(target)')
    const end = source.indexOf('\nfunction preparedActivator()', begin)
    const predicate = source.slice(begin, end)
    const env = {
      runtimeRoot: 'checkout',
      root: 'checkout',
      STABLE_SOURCE_BRANCH: 'stable',
      readActiveRuntimeRecord: () => undefined as unknown,
      gitValue: (_cwd: string, args: string[]) => args[0] === 'branch' ? 'stable' : 'old-head',
      gitClean: () => true,
      gitSucceeds: () => true,
      isManagedReleaseBranch: (branch: string) => branch === 'stable' || branch === 'main',
      preparedStageForTarget: (): string | undefined => 'verified-stage',
    }
    const makePredicate = () => runInNewContext(predicate + '\nsafeInPlacePreparedFallback', env) as (target: string) => boolean
    expect(makePredicate()('new-head')).toBe(true)
    env.runtimeRoot = 'isolated-runtime'
    expect(makePredicate()('new-head')).toBe(false)
    env.runtimeRoot = 'checkout'
    env.readActiveRuntimeRecord = () => ({ path: 'active' })
    expect(makePredicate()('new-head')).toBe(false)
    env.readActiveRuntimeRecord = () => undefined
    env.gitClean = () => false
    expect(makePredicate()('new-head')).toBe(false)
    env.gitClean = () => true
    env.gitSucceeds = () => false
    expect(makePredicate()('new-head')).toBe(false)
    env.gitSucceeds = () => true
    env.preparedStageForTarget = () => undefined
    expect(makePredicate()('new-head')).toBe(false)
  })

  it('keeps cleanup-only mode available without spawning duplicate cleanup passes from each Host', () => {
    expect(source).toContain("if (process.argv.includes('--cleanup-storage'))")
    expect(source).toContain('recoverStaleStagingIndexLock()')
    expect(source).toContain('cleanupObsoleteRuntimes()')
    expect(updateWatchSource).toContain('const installRoot = process.env.PHOENIX_INSTALL_ROOT?.trim()')
    expect(updateWatchSource).not.toContain("startWatcher(root, supervisor, 'PHOENIX STORAGE', ['--cleanup-storage'])")
    expect(updateWatchSource).toContain('garbage collection is owned by the external')
  })

  it('defers expensive garbage collection until after Host startup and protects handoff paths', () => {
    const startup = source.indexOf('const initialBootChecksStartedAt = Date.now()')
    const spawn = source.indexOf('const host = startHost()', startup)
    expect(startup).toBeGreaterThan(0)
    expect(source.slice(startup, spawn)).not.toContain('cleanupObsoleteRuntimes()')
    expect(source).toContain('healthy Host checkpoint recorded as last-known-good configuration.')
    expect(source).toContain('repairUserGitSafeDirectory()\n      repairDesktopShortcut()')
    expect(source).toContain("if (readUpdateState()?.status !== 'preparing' || !watcherSupervisor?.isActive())")
    expect(source).toContain('cleanupObsoleteRuntimes()')
    expect(source).toContain('restoreActiveRuntime()\nprepareKokoroFallback()')
    expect(source).toContain("if (hostEvent.kind === 'safe-update-handoff') cleanupObsoleteRuntimes()")
    expect(source).toContain('clearActiveRuntime()\n    cleanupObsoleteRuntimes()')
  })

})
