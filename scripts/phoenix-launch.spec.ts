import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('PHOENIX restart-safe launcher contract', () => {
  it('routes the normal pnpm phoenix entrypoint through the restart-safe launcher', () => {
    const pkg = JSON.parse(source('package.json')) as { scripts?: Record<string, string> }

    expect(pkg.scripts?.phoenix).toBe('node scripts/phoenix-launch.mjs')
  })

  it('keeps a Windows supervisor alive while the web Host is restarted', () => {
    const launcher = source('scripts/phoenix-launch.mjs')

    expect(launcher).toContain("process.platform === 'win32'")
    expect(launcher).toContain("'scripts', 'phoenix-windows-supervisor.mjs'")
    expect(launcher).toContain("process.env.PHOENIX_UPDATE_SUPERVISED !== '1'")
    expect(launcher).toContain("'apps', 'cli', 'src', 'bin.ts'")
  })

  it('detaches the legacy Windows watcher so direct CLI launches can still self-restart', () => {
    const watcher = source('apps/cli/src/phoenix-update-watch.ts')

    expect(watcher).toContain("detached: process.platform === 'win32'")
    expect(watcher).toContain("stdio: process.platform === 'win32' ? 'ignore' : ['ignore', 'inherit', 'inherit']")
  })
})