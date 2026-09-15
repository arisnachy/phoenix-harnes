import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@phoenix-ai/cordis-plugin-include'

function presetRows(name: 'standard' | 'code'): { id?: string; name?: string }[] {
  const cliRoot = fileURLToPath(new URL('..', import.meta.url))
  const parsed = yaml.load(
    readFileSync(resolve(cliRoot, 'config', 'agent-presets', name, 'agent.cordis.yml'), 'utf8'),
    { schema: entryListSchema },
  )
  if (!Array.isArray(parsed)) throw new TypeError(`${name} preset must parse to a plugin list`)
  return parsed as { id?: string; name?: string }[]
}

describe('quality foresight agent presets', () => {
  for (const preset of ['standard', 'code'] as const) {
    it(`mounts tool-quality before tool-goal in ${preset}`, () => {
      const rows = presetRows(preset)
      const quality = rows.findIndex(row => row.id === 'tool-quality')
      const goal = rows.findIndex(row => row.id === 'tool-goal')
      expect(quality).toBeGreaterThanOrEqual(0)
      expect(rows[quality]?.name).toBe('@phoenix-ai/dsh-tool-quality')
      expect(goal).toBeGreaterThan(quality)
      expect(rows[goal]?.name).toBe('@phoenix-ai/dsh-tool-goal')
    })
  }
})
