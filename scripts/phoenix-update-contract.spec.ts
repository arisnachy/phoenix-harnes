import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import './promote-client-artifacts.ts'

const root = process.cwd()

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

describe('prepared client self-update contract', () => {
  it('ships the client artifact promoter required by the prepared activator', () => {
    expect(() => source('scripts/promote-client-artifacts.ts')).not.toThrow()
  })

  it('verifies prepared client artifacts with the staged target helper before touching live', () => {
    const activator = source('scripts/phoenix-activate-prepared.mjs')

    expect(activator).toContain(
      "node(stage, ['--import', 'tsx/esm', 'scripts/promote-client-artifacts.ts', '--from', stage, '--verify-only'])",
    )
  })

  it('allows verify-only to inspect a stage using the helper from that same stage', () => {
    const promoter = source('scripts/promote-client-artifacts.ts')

    expect(promoter).toContain("if (source === root && !values['verify-only'])")
  })

  it('binds cached prepared updates to the live base and a clean live checkout', () => {
    const updater = source('scripts/phoenix-auto-update.mjs')

    expect(updater).toContain('if (prepared.base !== currentCommit(root)) return false')
    expect(updater).toContain('if (!cleanWorktree(root)) return false')
    expect(updater).toContain("const stageStatus = git(stage, ['status', '--porcelain=v1', '--untracked-files=all'], { allowFailure: true })")
    expect(updater).toContain("phase: 'worktree'")
    expect(updater).toContain('local changes block preparation/activation')
  })

  it('reports an unchanged dirty checkout only once until its target or worktree changes', () => {
    const updater = source('scripts/phoenix-auto-update.mjs')

    expect(updater).toContain('let announcedDirtySignature')
    expect(updater).toContain('const dirtySignature =')
    expect(updater).toContain('if (announcedDirtySignature !== dirtySignature)')
    expect(updater).toContain('announcedDirtySignature = dirtySignature')
    expect(updater).toContain('announcedDirtySignature = undefined')
  })
})
