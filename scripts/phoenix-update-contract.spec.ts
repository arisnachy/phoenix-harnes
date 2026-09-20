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
    expect(activator).toContain('refs/phoenix/recovery/pre-stable-realign')
    expect(activator).toContain('requires a managed installation')
  })

  it('reanchors a stale prepared base inside the activator after all target checks pass', () => {
    const activator = source('scripts/phoenix-activate-prepared.mjs')

    expect(activator).toContain('prepared base ${previousBase.slice(0, 12)} became stale before activation')
    expect(activator).toContain("mode: 'full'")
    expect(activator).toContain('reanchoredFromBase: previousBase')
    expect(activator).toContain("writeFileSync(preparedPath, JSON.stringify(prepared, undefined, 2) + '\\n', 'utf8')")
  })

  it('allows verify-only to inspect a stage using the helper from that same stage', () => {
    const promoter = source('scripts/promote-client-artifacts.ts')

    expect(promoter).toContain("if (source === root && !values['verify-only'])")
  })

  it('keeps direct live-checkout activation fail-closed while allowing isolated runtime activation', () => {
    const updater = source('scripts/phoenix-auto-update.mjs')
    const supervisor = source('scripts/phoenix-windows-supervisor.mjs')

    expect(updater).toContain('if (prepared.base !== currentCommit(root)) return false')
    expect(updater).toContain('return stagedCandidateValid(root, target) && cleanWorktree(root)')
    expect(updater).toContain("const stageStatus = git(stage, ['status', '--porcelain=v1', '--untracked-files=all'], { allowFailure: true })")
    expect(updater).toContain('Auto-update is paused to protect user work')

    expect(supervisor).toContain('function activatePreparedRuntime(target)')
    expect(supervisor).toContain('function persistentRuntime(target)')
    expect(supervisor).toContain('const ACTIVE_RUNTIME_FILE = \'phoenix-active-runtime.json\'')
    expect(supervisor).toContain('runtimeRoot = runtime.path')
  })

  it('prepares dirty checkouts and advertises isolated-runtime activation instead of waiting for a clean checkout', () => {
    const updater = source('scripts/phoenix-auto-update.mjs')
    const supervisor = source('scripts/phoenix-windows-supervisor.mjs')
    const applyCaseStart = updater.indexOf("case 'apply':")
    const unchangedCaseStart = updater.indexOf("case 'unchanged':", applyCaseStart)
    const applyCase = updater.slice(applyCaseStart, unchangedCaseStart)

    expect(updater).toContain('function stagedCandidateValid(root, target)')
    expect(updater).toContain('function writePreparedState(root, inspection, plan)')
    expect(applyCase.indexOf('stageCandidate(root, inspection)')).toBeGreaterThanOrEqual(0)
    expect(applyCase).not.toContain('const localChanges = worktreeChanges(root)')
    expect(updater).toContain('local changes remain protected; restart to activate the verified isolated runtime.')
    expect(updater).not.toContain('activation waits for a clean checkout.')

    expect(supervisor).not.toContain('automatic update watcher paused for this session')
    expect(supervisor).toContain('activating the verified update in an isolated runtime; the live checkout will not be modified')
    expect(supervisor).toContain('activatePreparedRuntime(requestedTarget)')
  })

  it('uses the isolated runtime for host launch and configuration preflight without changing update control ownership', () => {
    const supervisor = source('scripts/phoenix-windows-supervisor.mjs')

    expect(supervisor).toContain('cwd: runtimeRoot')
    expect(supervisor).toContain('PHOENIX_RUNTIME_ROOT: runtimeRoot')
    expect(supervisor).toContain('restoreActiveRuntime()')
    expect(supervisor).toContain('cwd: root,')
  })
})

// Stable publication requires full-CI provenance for the exact current main SHA; no manual bypass is accepted.
describe('stable release publication contract', () => {
  it('moves stable to the exact approved main SHA with lease protection before publishing metadata', () => {
    const workflow = source('.github/workflows/phoenix-stable-update-channel.yml')
    const synchronize = workflow.indexOf('name: Synchronize stable release pointer')
    const publish = workflow.indexOf('name: Publish stable manifest')

    expect(synchronize).toBeGreaterThan(-1)
    expect(publish).toBeGreaterThan(synchronize)
    expect(workflow).toContain('--force-with-lease="refs/heads/stable:$stable_sha"')
    expect(workflow).toContain('origin "$TARGET_SHA:refs/heads/stable"')
    expect(workflow).toContain('"sourceBranch": "stable"')
  })

  it('publishes stable only after the complete CI matrix passes on the current main SHA', () => {
    const ci = source('.github/workflows/ci.yml')
    const publisher = source('.github/workflows/phoenix-stable-update-channel.yml')

    expect(ci).toContain('push:\\n    branches: [main]')
    expect(publisher).toContain('workflows: [CI]')
    expect(publisher).toContain('branches: [main]')
    expect(publisher).not.toContain('workflow_dispatch:')
    expect(publisher).toContain("if: github.event.workflow_run.conclusion == 'success'")
  })
})
