import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')
const cliSource = readFileSync(resolve('apps/cli/src/bin.ts'), 'utf8')
const acpPackage = JSON.parse(readFileSync(resolve('packages/examples/acp-demo/package.json'), 'utf8')) as { bin: Record<string, string> }
const jsonrpcPackage = JSON.parse(readFileSync(resolve('packages/examples/jsonrpc-demo/package.json'), 'utf8')) as { bin: Record<string, string> }

describe('PHOENIX Windows updater supervisor resilience', () => {
  it('restarts the updater watcher when it exits while the host is still alive', () => {
    expect(source).toContain('function superviseWatcher(host)')
    expect(source).toContain('watcher exited unexpectedly')
    expect(source).toContain('restartTimer = setTimeout(start, WATCHER_RESTART_DELAY_MS)')
    expect(source).toContain('restartTimer.unref?.()')
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

  it('reconciles stale runtime and client artifacts before the Windows supervisor starts', () => {
    expect(cliSource).toContain("import { preparePhoenixWebRuntime } from './phoenix-runtime-freshness.ts'")
    expect(cliSource).toContain('preparePhoenixWebRuntime(runtimeSourceRoot)')
    expect(cliSource).toContain("const runtimeSourceRoot = resolve(supervisor, '..', '..')")
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

  it('retires a stale isolated runtime when a clean managed checkout has advanced past it', () => {
    expect(source).toContain('function activeRuntimeIsSupersededByLiveCheckout(target)')
    expect(source).toContain('liveStatus.entries.length > 0')
    expect(source).toContain('isManagedReleaseBranch(liveBranch, STABLE_SOURCE_BRANCH)')
    expect(source).toContain("['merge-base', '--is-ancestor', target, liveHead]")
    expect(source).toContain('activeRuntimeIsSupersededByLiveCheckout(value.target)')
    expect(source).toContain('retired stale isolated runtime')
    expect(source).toContain('clean managed checkout is newer')
  })

  it('retires an isolated runtime that crashes before its health checkpoint', () => {
    expect(source).toContain('if (earlyCrash && runtimeRoot !== root)')
    expect(source).toContain('const failedRuntime = runtimeRoot')
    expect(source).toContain('runtimeRoot = root')
    expect(source).toContain('clearActiveRuntime()')
    expect(source).toContain('falling back to the source checkout')
  })

})