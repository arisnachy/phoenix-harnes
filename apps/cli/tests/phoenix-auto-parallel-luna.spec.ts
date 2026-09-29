import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

describe('Phoenix Auto parallel Luna delegation', () => {
  it('keeps every full preset on bounded GPT-6 Luna Max workers', async () => {
    const presets = await Promise.all(
      ['standard', 'code', 'cordis'].map(async name => ({
        name,
        content: await readFile(`${PRESET_ROOT}${name}/agent.cordis.yml`, 'utf8'),
      })),
    )

    for (const { name, content } of presets) {
      const lunaRoutes = content.match(/model: gpt-6-luna\n\s+reasoningEffort: max/gu) ?? []
      expect(lunaRoutes, `${name} should pin subagent, fork, and workflow children to GPT-6 Luna Max`)
        .toHaveLength(3)
      expect(content).toContain('maxConcurrentAgents: 2')
      expect(content).toContain('maxTotalAgents: 2')
      expect(content).toContain('GPT-6 Luna Max')
      expect(content).toContain('workflow')
      expect(content).not.toContain('model: gpt-5.6-luna\n          reasoningEffort: xhigh')
    }
  })
})
