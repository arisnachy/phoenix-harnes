import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

describe('full preset memory parity', () => {
  it('keeps durable learning memory in every full preset and out of minimal', async () => {
    const memoryRow = [
      '- id: tool-session-learning',
      "  name: '@phoenix-ai/dsh-tool-session-learning'",
    ].join('\n')
    const fullPresets = await Promise.all(
      ['standard', 'code', 'cordis'].map(async name =>
        readFile(`${PRESET_ROOT}${name}/agent.cordis.yml`, 'utf8')),
    )
    const minimal = await readFile(`${PRESET_ROOT}minimal/agent.cordis.yml`, 'utf8')

    for (const preset of fullPresets) expect(preset).toContain(memoryRow)
    expect(minimal).not.toContain(memoryRow)
  })
})
