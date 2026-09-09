import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('PHOENIX restart-safe updater contract', () => {
  it('detaches the legacy Windows watcher so direct pnpm phoenix launches can self-restart', () => {
    const watcher = source('apps/cli/src/phoenix-update-watch.ts')

    expect(watcher).toContain("const detachedForWindowsRestart = process.platform === 'win32'")
    expect(watcher).toContain('detached: detachedForWindowsRestart')
    expect(watcher).toContain("stdio: detachedForWindowsRestart ? 'ignore' : ['ignore', 'inherit', 'inherit']")
    expect(watcher).toContain('child.unref()')
  })

  it('keeps supervised launches single-owner to avoid competing activators', () => {
    const watcher = source('apps/cli/src/phoenix-update-watch.ts')
    const supervisor = source('scripts/phoenix-windows-supervisor.mjs')

    expect(watcher).toContain("if (process.env.PHOENIX_UPDATE_SUPERVISED === '1') return")
    expect(supervisor).toContain("PHOENIX_UPDATE_SUPERVISED: '1'")
    expect(supervisor).toContain('await watcherSupervisor.stop()')
    expect(supervisor).toContain('const activationCode = activatePrepared()')
  })

  it('clears both prepared and restart markers only after successful activation and smoke', () => {
    const activator = source('scripts/phoenix-activate-prepared.mjs')

    const smoke = activator.indexOf('smoke(root, prepared.mode)')
    const clearPrepared = activator.indexOf('clearFile(preparedPath)', smoke)
    const clearRequest = activator.indexOf('clearFile(requestPath)', smoke)
    const updatedState = activator.indexOf("status: 'updated'", smoke)

    expect(smoke).toBeGreaterThan(-1)
    expect(clearPrepared).toBeGreaterThan(smoke)
    expect(clearRequest).toBeGreaterThan(clearPrepared)
    expect(updatedState).toBeGreaterThan(clearRequest)
  })
})