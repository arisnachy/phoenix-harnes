import { describe, expect, it } from 'vitest'
import { collectToolCatalog } from './gen-tool-catalog.ts'

describe('cross-platform tool catalog', () => {
  it('includes the Windows computer definition exactly once on every host', async () => {
    const catalog = await collectToolCatalog()
    const pwsh = catalog.find(entry => entry.pkg === '@phoenix-ai/dsh-tool-pwsh')
    expect(pwsh?.schemas.filter(schema => schema.name === 'computer')).toHaveLength(1)
    expect(pwsh?.schemas.find(schema => schema.name === 'computer')?.description)
      .toContain('Windows desktop')
  }, 60_000)
})
