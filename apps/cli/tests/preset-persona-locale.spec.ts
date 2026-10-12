import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))
const PRESETS = ['standard', 'code', 'minimal', 'cordis', 'kira-max'] as const

describe('shipped YAML persona language contract', () => {
  it.each(PRESETS)('%s interpolates the actual selected language in its operative persona', async (id) => {
    const text = await readFile(`${root}${id}/agent.cordis.yml`, 'utf8')
    const persona = text.split('\n- id:')[1]
    expect(persona).toContain('persona')
    expect(persona).toContain('{{phoenix_locale_instruction}}')
    expect((text.match(/{{phoenix_locale_instruction}}/g) ?? [])).toHaveLength(1)
    expect(text).toContain("name: '@phoenix-ai/dsh-persona'")
  })

  it('minimal still protects its complete, two-tool agent contract', async () => {
    const yaml = await readFile(`${root}minimal/agent.cordis.yml`, 'utf8')
    expect(yaml).toContain('    complete: true')
    expect(yaml).toContain('    includeRuntimeContext: false')
  })
})
