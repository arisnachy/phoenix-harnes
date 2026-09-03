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

    expect(activator).toContain(
      "node(stage, ['--import', 'tsx/esm', 'scripts/promote-client-artifacts.ts', '--from', stage, '--verify-only'])",
    )
  })

  it('allows verify-only to inspect a stage using the helper from that same stage', () => {
    const promoter = source('scripts/promote-client-artifacts.ts')

    expect(promoter).toContain("if (source === root && !values['verify-only'])")
  })
})
