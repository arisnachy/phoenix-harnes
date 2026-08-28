import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')

describe('PHOENIX Windows updater supervisor resilience', () => {
  it('restarts the updater watcher when it exits while the host is still alive', () => {
    expect(source).toContain('function superviseWatcher(host)')
    expect(source).toContain('watcher exited unexpectedly')
    expect(source).toContain('restartTimer = setTimeout(start, WATCHER_RESTART_DELAY_MS)')
  })

  it('disables watcher respawn before an intentional host/update shutdown', () => {
    expect(source).toContain('await watcherSupervisor.stop()')
    expect(source).toContain('stopping = true')
  })
})
