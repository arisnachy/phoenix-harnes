import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@phoenix-ai/cordis-plugin-include'

type Row = { id?: string; name?: string; config?: Record<string, unknown> }

/** Real deployable base profile, not an isolated mock provider composition. */
function researchRows(): Row[] {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const parsed = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), {
    schema: entryListSchema,
  })
  if (!Array.isArray(parsed)) throw new Error('base Cordis patch must parse')
  return parsed.flatMap((entry): Row[] =>
    typeof entry === 'object' && entry !== null
      ? (entry as { insert?: Row[] }).insert ?? [] : [])
}

describe('production research source access', () => {
  it('exposes actual bounded web_fetch alongside web_search in the shipped base bundle', () => {
    const rows = researchRows()
    const service = rows.find(row => row.id === 'web')
    const reader = rows.find(row => row.id === 'web-fetch-http')
    const tools = rows.find(row => row.id === 'tool-web')
    expect(service?.config).toMatchObject({ searchProvider: 'openrouter', fetchProvider: 'http' })
    expect(reader?.name).toBe('@phoenix-ai/dsh-web-fetch-http')
    expect(tools?.config).toMatchObject({ searchMaxQueries: 3, searchMaxResults: 8, fetch: true })
    expect(rows.filter(row => row.id === 'web-fetch-http')).toHaveLength(1)
  })

  it('refuses private network reading and caps size, redirects and time', () => {
    const rows = researchRows()
    const source = rows.find(row => row.id === 'web-fetch-http')?.config
    const tool = rows.find(row => row.id === 'tool-web')?.config
    expect(source).toBeDefined()
    expect(source?.allowPrivateNetworks).toBe(false)
    expect(source?.maxRedirects).toBeLessThanOrEqual(2)
    expect(source?.maxResponseBytes).toBeLessThanOrEqual(1_500_000)
    expect(source?.maxBodyChars).toBeLessThanOrEqual(80_000)
    expect(source?.timeoutMs).toBeLessThanOrEqual(15_000)
    expect(tool?.fetchTimeoutMs).toBeLessThanOrEqual(15_000)
    expect(tool?.fetchMaxOutputChars).toBeLessThanOrEqual(50_000)
  })
})
