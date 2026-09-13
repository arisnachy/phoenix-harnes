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
      "node(stage, ['--import', 'tsx/esm', 'scripts/promote-client-artifacts.ts', '--from', stage, '--verify-only'], { inherit: true })",
    )
  })

  it('supports managed realignment when a prepared stable target diverges', () => {
    const activator = source('scripts/phoenix-activate-prepared.mjs')

    expect(activator).toContain('classifyPreparedActivation')
    expect(activator).toContain("git(root, ['reset', '--hard', target], { inherit: true })")
    expect(activator).toContain("refs/phoenix/recovery/pre-stable-realign")
    expect(activator).toContain('requires a managed installation')
  })

  it('allows verify-only to inspect a stage using the helper from that same stage', () => {
    const promoter = source('scripts/promote-client-artifacts.ts')

    expect(promoter).toContain("if (source === root && !values['verify-only'])")
  })

  it('binds cached prepared updates to the live base and a clean live checkout', () => {
    const updater = source('scripts/phoenix-auto-update.mjs')

    expect(updater).toContain('if (prepared.base !== currentCommit(root)) return false')
    expect(updater).toContain('return stagedCandidateValid(root, target) && cleanWorktree(root)')
    expect(updater).toContain("const stageStatus = git(stage, ['status', '--porcelain=v1', '--untracked-files=all'], { allowFailure: true })")
    expect(updater).toContain("phase: 'worktree'")
    expect(updater).toContain('Auto-update is paused to protect user work')
  })

  it('prepares dirty checkouts in isolated staging and reserves activation for a clean checkout', () => {
    const updater = source('scripts/phoenix-auto-update.mjs')
    const applyCaseStart = updater.indexOf("case 'apply':")
    const unchangedCaseStart = updater.indexOf("case 'unchanged':", applyCaseStart)
    const applyCase = updater.slice(applyCaseStart, unchangedCaseStart)

    expect(updater).toContain('function stagedCandidateValid(root, target)')
    expect(updater).toContain('function writePreparedState(root, inspection, plan)')
    expect(applyCase.indexOf('stageCandidate(root, inspection)')).toBeGreaterThanOrEqual(0)
    expect(applyCase).not.toContain('const localChanges = worktreeChanges(root)')
    expect(updater).toContain('local changes remain protected; activation waits for a clean checkout.')
  })
})
