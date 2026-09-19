import { describe, expect, it } from 'vitest'
import {
  codexCatalogIsAutomatic,
  codexModelsToProfiles,
} from '../src/codex-live-catalog.ts'

describe('Codex automatic live catalog policy', () => {
  it('respects a non-empty human-pinned model list', () => {
    expect(codexCatalogIsAutomatic(undefined)).toBe(false)
    expect(codexCatalogIsAutomatic({})).toBe(true)
    expect(codexCatalogIsAutomatic({ models: [] })).toBe(true)
    expect(codexCatalogIsAutomatic({ models: [{ id: 'pinned-model' }] })).toBe(false)
  })

  it('projects the exact live model set and ignores unsupported future effort levels safely', () => {
    expect(codexModelsToProfiles([
      {
        id: 'new-live-model',
        name: 'New Live Model',
        reasoning: {
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'high', name: 'High' },
            { id: 'ultra', name: 'Ultra' },
          ],
          defaultEffort: 'low',
        },
      },
      { id: 'second-live-model' },
    ])).toEqual([
      {
        id: 'new-live-model',
        name: 'New Live Model',
        reasoningEfforts: { low: 'low', high: 'high' },
      },
      { id: 'second-live-model' },
    ])
  })
})
