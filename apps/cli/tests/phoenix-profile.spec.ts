/** The CLI-owned PHOENIX bundle patch is its runtime contract. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('PHOENIX bundle', () => {
  it('declares a parseable CLI-owned layer with only local and free routes', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./config/phoenix/cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    )
    expect(Array.isArray(parsed)).toBe(true)
    const patches = parsed as {
      id?: string
      config?: Record<string, unknown>
      insert?: { id?: string; name?: string; config?: Record<string, unknown> }[]
    }[]
    const llm = patches.find(patch => patch.id === 'llm-pi-ai')
    const providers = (llm?.config?.['providers'] ?? {}) as Record<string, { models?: { id?: string }[] }>
    expect(Object.keys(providers)).toEqual(['phoenix-local', 'phoenix-free'])
    expect(providers['phoenix-free']?.models?.map(model => model.id)).toEqual(['orcarouter/free'])
    expect(JSON.stringify(parsed)).not.toContain('orcarouter/auto')
    expect(JSON.stringify(parsed)).not.toContain('paid')
    const router = patches.flatMap(patch => patch.insert ?? []).find(row => row.id === 'phoenix-model-router')
    expect(router).toMatchObject({
      name: '@deepseek-ai/dsh/phoenix-router',
      config: {
        local: { provider: 'phoenix-local', model: 'qwen3:8b' },
        free: { provider: 'phoenix-free', model: 'orcarouter/free' },
      },
    })
  })
})
