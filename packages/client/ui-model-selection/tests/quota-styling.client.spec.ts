// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Codex quota styling', () => {
  it('keeps the quota presentation inline with Settings instead of a colored pill', () => {
    const css = readFileSync(resolve(process.cwd(), 'packages/client/ui-model-selection/src/client/CodexQuotaRemaining.module.css'), 'utf8')
    const rootBlock = css.match(/\.root\s*\{([\s\S]*?)\}/u)?.[1] ?? ''

    expect(rootBlock).not.toMatch(/^\s*(?:background|border|box-shadow|border-radius)\s*:/mu)
    // The card itself stays inline; the file's separate meter rule may use a
    // circular gradient for the actual quota indicator.
    expect(rootBlock).not.toMatch(/conic-gradient|linear-gradient|#b96f55|#c5765a|#6f8eae/u)
  })
})
