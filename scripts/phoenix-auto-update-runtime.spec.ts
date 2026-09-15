import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const updater = readFileSync(resolve('scripts/phoenix-auto-update.mjs'), 'utf8')
const supervisor = readFileSync(resolve('scripts/phoenix-windows-supervisor.mjs'), 'utf8')

describe('PHOENIX supervised updater runtime isolation', () => {
  it('shares updater control markers through the common Git directory across worktrees', () => {
    expect(updater).toContain('function controlDirectory(root)')
    expect(updater).toContain('return gitCommonDirectory(root) ?? gitDirectory(root)')
    expect(updater).toContain('join(controlDirectory(root), STATE_FILE)')
    expect(updater).toContain('join(controlDirectory(root), PREPARED_FILE)')
  })

  it('allows the supervisor to stage stable while the source checkout stays on a development branch', () => {
    expect(updater).toContain("isolatedRuntime: process.env.PHOENIX_UPDATE_SUPERVISED === '1'")
    expect(updater).toContain("case 'isolate':")
  })

  it('runs the watcher from the active runtime so an isolated update becomes the new version baseline', () => {
    expect(supervisor).toContain('cwd: runtimeRoot')
    expect(supervisor).toContain('PHOENIX_RUNTIME_ROOT: runtimeRoot')
  })
})
