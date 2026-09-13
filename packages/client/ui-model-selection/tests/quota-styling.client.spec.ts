// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Codex quota styling', () => {
  it('keeps the quota presentation inline with Settings instead of a colored pill', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/client/ui-model-selection/src/client/CodexQuotaRemaining.module.css'), 'utf8')
    const rootBlock = css.match(/\.root\s*\{([\s\S]*?)\}/u)?.[1] ?? ''

    expect(rootBlock).not.toMatch(/^\s*(?:background|border|box-shadow|border-radius)\s*:/mu)
    expect(css).not.toMatch(/conic-gradient|linear-gradient|#b96f55|#c5765a|#6f8eae/u)
  })
})
