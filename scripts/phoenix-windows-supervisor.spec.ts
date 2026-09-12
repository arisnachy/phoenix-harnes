import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')
const cliSource = readFileSync(resolve('apps/cli/src/bin.ts'), 'utf8')

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

  it('pauses activation before invoking the prepared activator when the live checkout is dirty', () => {
    expect(source).toContain('const liveStatus = gitStatus(root)')
    expect(source).toContain('if (!liveStatus.ok || liveStatus.entries.length > 0)')
    expect(source).toContain('reportDirtyActivationBlock(liveStatus)')
    expect(source).toContain('Commit, stash, or intentionally discard those changes')
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
})
