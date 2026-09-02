import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')

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

  it('uses only an exact clean verified staged activator for prepared self-updates', () => {
    expect(source).toContain('function preparedActivator()')
    expect(source).toContain("const stagedActivator = join(stage, 'scripts', 'phoenix-activate-prepared.mjs')")
    expect(source).toContain('target !== undefined')
    expect(source).toContain('sameRepository(stage)')
    expect(source).toContain('gitClean(stage)')
    expect(source).toContain("gitValue(stage, ['rev-parse', 'HEAD']) === target")
    expect(source).toContain('using the verified staged activator for prepared self-update compatibility')
  })
})
