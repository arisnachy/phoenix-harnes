import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

describe('Phoenix Auto Sol/Luna execution and review', () => {
  it('keeps every full preset on bounded latest-Luna workers with independent review', async () => {
    const presets = await Promise.all(
      ['standard', 'code', 'cordis'].map(async name => ({
        name,
        content: await readFile(`${PRESET_ROOT}${name}/agent.cordis.yml`, 'utf8'),
      })),
    )

    for (const { name, content } of presets) {
      const lunaFallbackRoutes = content.match(/model: gpt-6-luna\n\s+inheritParentModelPattern: '-luna\(\?:\$\|-\)'\n\s+reasoningEffort: max/gu) ?? []
      expect(lunaFallbackRoutes, `${name} should keep three latest-family-aware Luna child routes`)
        .toHaveLength(3)
      expect(content).toContain('maxConcurrentAgents: 2')
      expect(content).toContain('maxTotalAgents: 2')
      expect(content).toContain('PHOENIX_AUTO_REVIEW')
      expect(content).toMatch(/fresh independent Luna reviewer|Luna fresco e independiente/u)
      expect(content).toMatch(/final decision|decisi[oó]n final/u)
      expect(content).toMatch(/games, 3D|juegos, 3D/u)
      expect(content).toContain('workflow')
      expect(content).not.toContain('model: gpt-5.6-luna\n          reasoningEffort: xhigh')
    }
  })
})
