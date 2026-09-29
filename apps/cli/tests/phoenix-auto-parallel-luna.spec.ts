import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

describe('Phoenix Auto bounded Luna delegation', () => {
  it('keeps every full preset on bounded latest-family-aware Luna child routes', async () => {
    const presets = await Promise.all(
      ['standard', 'code', 'cordis'].map(async name => ({
        name,
        content: await readFile(`${PRESET_ROOT}${name}/agent.cordis.yml`, 'utf8'),
      })),
    )

    const lunaRoutePattern = /model: gpt-6-luna\n\s+inheritParentModelPattern: '-luna\(\?:\$\|-\)'\n\s+reasoningEffort: max/gu
    for (const { name, content } of presets) {
      const lunaFallbackRoutes = content.match(lunaRoutePattern) ?? []
      expect(lunaFallbackRoutes, `${name} should keep three latest-family-aware Luna child routes`)
        .toHaveLength(3)
      expect(content).toContain('maxConcurrentAgents: 2')
      expect(content).toContain('maxTotalAgents: 2')
      expect(content).toContain('workflow')
      expect(content).not.toContain('model: gpt-5.6-luna\n          reasoningEffort: xhigh')
    }
  })
})
