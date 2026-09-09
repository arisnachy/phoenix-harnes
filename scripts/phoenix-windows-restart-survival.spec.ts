import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('PHOENIX direct Windows restart survival', () => {
  it('detaches the updater watcher and disconnects inherited stdio for direct pnpm phoenix launches', () => {
    const watcher = source('apps/cli/src/phoenix-update-watch.ts')

    expect(watcher).toContain("const detachedForWindowsRestart = process.platform === 'win32'")
    expect(watcher).toContain('detached: detachedForWindowsRestart')
    expect(watcher).toContain("stdio: detachedForWindowsRestart ? 'ignore' : ['ignore', 'inherit', 'inherit']")
    expect(watcher).toContain('child.unref()')
  })
})
