import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('PHOENIX profile bundle', () => {
  it('declares a parseable native DSH patch with the adaptive runtime and dormant official bridges', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@arisnachy/phoenix-runtime')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-subagent-codex')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-subagent-claude-code')

    const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
    expect(Array.isArray(parsed)).toBe(true)
    const rows = (parsed as { insert?: { id?: string; name?: string }[] }[]).flatMap(patch => patch.insert ?? [])
    expect(rows).toContainEqual(expect.objectContaining({ id: 'phoenix-runtime', name: '@arisnachy/phoenix-runtime' }))
    expect(rows).toContainEqual(expect.objectContaining({ id: 'subagent-codex', name: '@deepseek-ai/dsh-subagent-codex' }))
    expect(rows).toContainEqual(expect.objectContaining({ id: 'subagent-claude-code', name: '@deepseek-ai/dsh-subagent-claude-code' }))
    expect(rows.some(row => /peer|remote-exec|auto-update/i.test(`${row.id} ${row.name}`))).toBe(false)
  })
})
