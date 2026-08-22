import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('PHOENIX profile bundle', () => {
  it('declares a parseable native DSH patch with adaptive runtime, AI bus, Repo Brain, and dormant official bridges', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-phoenix-ai-bus')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-phoenix-repo-brain')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-phoenix-runtime')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-subagent-codex')
    expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-subagent-claude-code')

    const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), { schema: entryListSchema })
    expect(Array.isArray(parsed)).toBe(true)
    const patches = parsed as {
      id?: string
      config?: Record<string, unknown>
      insert?: { id?: string; name?: string }[]
    }[]
    const rows = patches.flatMap(patch => patch.insert ?? [])
    expect(rows).toContainEqual(expect.objectContaining({ id: 'phoenix-ai-bus', name: '@deepseek-ai/dsh-phoenix-ai-bus' }))
    expect(rows).toContainEqual(expect.objectContaining({ id: 'phoenix-repo-brain', name: '@deepseek-ai/dsh-phoenix-repo-brain' }))
    expect(rows).toContainEqual(expect.objectContaining({ id: 'phoenix-runtime', name: '@deepseek-ai/dsh-phoenix-runtime' }))
    expect(rows).toContainEqual(expect.objectContaining({ id: 'subagent-codex', name: '@deepseek-ai/dsh-subagent-codex' }))
    expect(rows).toContainEqual(expect.objectContaining({ id: 'subagent-claude-code', name: '@deepseek-ai/dsh-subagent-claude-code' }))
    expect(rows.some(row => /peer|remote-exec|auto-update/i.test(`${row.id} ${row.name}`))).toBe(false)

    const llmPatch = patches.find(patch => patch.id === 'llm-pi-ai')
    const providers = (llmPatch?.config as { providers?: Record<string, unknown> } | undefined)?.providers
    const orca = providers?.orcarouter as { apiKeyEnv?: string; baseURL?: string; models?: { id?: string }[] } | undefined
    expect(orca?.apiKeyEnv).toBe('ORCAROUTER_API_KEY')
    expect(orca?.baseURL).toBe('https://api.orcarouter.ai/v1')
    expect(orca?.models?.[0]?.id).toBe('orcarouter/free')
    expect(JSON.stringify(llmPatch)).not.toMatch(/sk-orca|authorization/i)
  })
})
