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
})

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

  it('requires the full repository baseline before a main SHA can become a release candidate', () => {
    const guard = source('.github/workflows/phoenix-main-guard.yml')
    const baseline = guard.indexOf('run: pnpm run check:all')
    const build = guard.indexOf('run: pnpm run build')

    expect(baseline).toBeGreaterThan(-1)
    expect(build).toBeGreaterThan(baseline)
  })
})
