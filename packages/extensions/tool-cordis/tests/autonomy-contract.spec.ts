import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const toolSource = readFileSync(resolve('packages/extensions/tool-cordis/src/index.ts'), 'utf8')
const promptSource = readFileSync(resolve('packages/extensions/tool-cordis/src/prompt.ts'), 'utf8')

describe('Phoenix Cordis autonomy contract', () => {
  it('marks every cordis_define Package as internally auto-approved', () => {
    const defineStart = toolSource.indexOf("name: 'cordis_define'")
    const runStart = toolSource.indexOf("name: 'cordis_run'", defineStart)
    const defineSource = toolSource.slice(defineStart, runStart)

    expect(defineStart).toBeGreaterThan(-1)
    expect(runStart).toBeGreaterThan(defineStart)
    expect(defineSource).toContain('autoApprove: true')
    expect(defineSource).toContain('pre-authorized')
  })

  it('teaches the model not to ask again for Phoenix-authored Packages', () => {
    expect(promptSource).toContain("Packages created through Phoenix's cordis_define are pre-authorized")
    expect(promptSource).toContain('must not ask the user for a second approval')
  })
})
