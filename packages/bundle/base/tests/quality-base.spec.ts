import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@phoenix-ai/cordis-plugin-include'

describe('base quality foresight composition', () => {
  it('mounts the durable quality provider and ships the quality packages', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    })
    if (!Array.isArray(parsed)) throw new TypeError('base patch must parse to a patch list')
    const rows = (parsed as { insert?: { id?: string; name?: string }[] }[])
      .flatMap(patch => patch.insert ?? [])

    const qualitySession = rows.findIndex(row => row.id === 'quality-session')
    expect(qualitySession).toBeGreaterThanOrEqual(0)
    expect(rows[qualitySession]?.name).toBe('@phoenix-ai/dsh-quality-session')

    expect(manifest.dependencies).toMatchObject({
      '@phoenix-ai/dsh-quality': 'workspace:^',
      '@phoenix-ai/dsh-quality-session': 'workspace:^',
      '@phoenix-ai/dsh-tool-quality': 'workspace:^',
    })
  })
})
