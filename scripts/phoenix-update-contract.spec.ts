import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

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
    const stagedHelper = "join(stage, 'scripts', 'promote-client-artifacts.ts')"
    const verifyAt = activator.indexOf("'--verify-only'")
    const mergeAt = activator.indexOf("['merge', '--ff-only', target]")

    expect(activator).toContain(stagedHelper)
    expect(activator).toContain('prepared update is missing its client artifact promoter')
    expect(verifyAt).toBeGreaterThan(-1)
    expect(mergeAt).toBeGreaterThan(-1)
    expect(verifyAt).toBeLessThan(mergeAt)
  })

  it('promotes with the newly activated live helper after the fast-forward merge', () => {
    const activator = source('scripts/phoenix-activate-prepared.mjs')
    const liveHelper = "join(root, 'scripts', 'promote-client-artifacts.ts')"
    const mergeAt = activator.indexOf("['merge', '--ff-only', target]")
    const liveHelperAt = activator.indexOf(liveHelper)

    expect(liveHelperAt).toBeGreaterThan(mergeAt)
    expect(activator).toContain('activated update is missing its client artifact promoter')
  })

  it('does not resolve the promoter relative to the old process working directory', () => {
    const activator = source('scripts/phoenix-activate-prepared.mjs')

    expect(activator).not.toContain(
      "node(stage, ['--import', 'tsx/esm', 'scripts/promote-client-artifacts.ts'",
    )
    expect(activator).not.toContain(
      "node(root, ['--import', 'tsx/esm', 'scripts/promote-client-artifacts.ts'",
    )
  })

  it('allows verify-only to inspect a stage using the helper from that same stage', () => {
    const promoter = source('scripts/promote-client-artifacts.ts')

    expect(promoter).toContain("if (source === root && !values['verify-only'])")
  })
})
