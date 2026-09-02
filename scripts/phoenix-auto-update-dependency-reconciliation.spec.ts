import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const updaterSource = readFileSync(new URL('./phoenix-auto-update.mjs', import.meta.url), 'utf8')

describe('Phoenix staged updater dependency reconciliation', () => {
  it('reconciles locked dev dependencies for every buildable candidate instead of trusting stale stage node_modules', () => {
    expect(updaterSource).toContain("corepack(root, ['pnpm', 'install', '--frozen-lockfile', '--prod=false'], { inherit: true })")
    expect(updaterSource).not.toContain("reusing installed dependencies")
    expect(updaterSource).not.toContain("existsSync(join(root, 'node_modules', '.pnpm'))")
  })
})
