import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/AppFrame.module.css', import.meta.url), 'utf8')

describe('KIRA floating overlay clearance', () => {
  it('reserves only the expanded desktop card footprint', () => {
    expect(css).toMatch(/--dsh-shell-right-overlay-inset:\s*0px/)
    expect(css).toMatch(/@media \(min-width:\s*761px\)/)
    expect(css).toMatch(
      /\[data-kira-teams\]:not\(\[data-kira-collapsed\]\)[^{]*\{[^}]*--dsh-shell-right-overlay-inset:\s*336px/s,
    )
  })
})
