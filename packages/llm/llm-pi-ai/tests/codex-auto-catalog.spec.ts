import { describe, expect, it, vi } from 'vitest'
import {
  CODEX_PROVIDER,
  CodexLiveCatalog,
  codexCatalogIsAutomatic,
  codexModelsToProfiles,
} from '../src/codex-live-catalog.ts'
import type { CodexDiscoveredModel } from '../src/codex-discovery.ts'

describe('Codex automatic live catalog policy', () => {
  it('respects a non-empty human-pinned model list', () => {
    expect(codexCatalogIsAutomatic(undefined)).toBe(false)
    expect(codexCatalogIsAutomatic({})).toBe(true)
    expect(codexCatalogIsAutomatic({ models: [] })).toBe(true)
    expect(codexCatalogIsAutomatic({ models: [{ id: 'pinned-model' }] })).toBe(false)
  })

  it('projects optional metadata and ignores unsupported future effort levels safely', () => {
    expect(codexModelsToProfiles([
      {
        id: 'new-live-model',
        name: 'New Live Model',
        contextWindow: 123_456,
        maxTokens: 7_890,
        reasoning: {
          efforts: [
            { id: 'off', name: 'Off' },
            { id: 'low', name: 'Low' },
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
        contextWindow: 123_456,
        maxTokens: 7_890,
        reasoningEfforts: { off: null, low: 'low' },
      },
      { id: 'second-live-model' },
    ])
  })

  it('replaces selector visibility while retaining installed and previously-seen dispatch models', async () => {
    let now = 0
    let next: CodexDiscoveredModel[] = [
      { id: 'new-live-model', name: 'New' },
      { id: 'second-live-model', name: 'Second' },
    ]
    const list = vi.fn(async () => next)
    const warn = vi.fn()
    const catalog = new CodexLiveCatalog({
      transport: { list },
      now: () => now,
      refreshIntervalMs: 10,
      installedModelIds: () => ['installed-only', 'new-live-model'],
      logger: { warn },
    })
    const automatic = { [CODEX_PROVIDER]: {} }
    const pinned = { [CODEX_PROVIDER]: { models: [{ id: 'pinned-model' }] } }

    expect(catalog.overlayProviders(automatic)).toBe(automatic)
    expect(await catalog.refresh('not-codex', {})).toBeUndefined()
    expect(await catalog.refresh(CODEX_PROVIDER, pinned[CODEX_PROVIDER])).toBeUndefined()
    expect(list).not.toHaveBeenCalled()

    await expect(catalog.refresh(CODEX_PROVIDER, automatic[CODEX_PROVIDER]))
      .resolves.toEqual(['new-live-model', 'second-live-model'])
    expect(catalog.revision).toBe(1)
    expect(catalog.overlayProviders(automatic)[CODEX_PROVIDER]?.models?.map(model => model.id))
      .toEqual(['installed-only', 'new-live-model', 'second-live-model'])
    expect(catalog.overlayProviders(pinned)).toBe(pinned)

    now = 5
    await catalog.refresh(CODEX_PROVIDER, automatic[CODEX_PROVIDER])
    await catalog.refresh(CODEX_PROVIDER, automatic[CODEX_PROVIDER], true)
    expect(list).toHaveBeenCalledTimes(1)

    now = 11
    await catalog.refresh(CODEX_PROVIDER, automatic[CODEX_PROVIDER])
    expect(list).toHaveBeenCalledTimes(2)
    expect(catalog.revision).toBe(1)

    next = [{ id: 'second-live-model', name: 'Second' }]
    now = 22
    await expect(catalog.refresh(CODEX_PROVIDER, automatic[CODEX_PROVIDER]))
      .resolves.toEqual(['second-live-model'])
    expect(catalog.revision).toBe(2)
    expect(catalog.overlayProviders(automatic)[CODEX_PROVIDER]?.models?.map(model => model.id))
      .toEqual(['installed-only', 'new-live-model', 'second-live-model'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('coalesces concurrent refreshes', async () => {
    let release: ((models: readonly CodexDiscoveredModel[]) => void) | undefined
    const list = vi.fn(() => new Promise<readonly CodexDiscoveredModel[]>((resolve) => {
      release = resolve
    }))
    const catalog = new CodexLiveCatalog({
      transport: { list },
      now: () => 0,
      refreshIntervalMs: 10,
      installedModelIds: () => [],
    })

    const first = catalog.refresh(CODEX_PROVIDER, {})
    const second = catalog.refresh(CODEX_PROVIDER, {})
    expect(list).toHaveBeenCalledTimes(1)
    release?.([{ id: 'coalesced-model' }])

    await expect(first).resolves.toEqual(['coalesced-model'])
    await expect(second).resolves.toEqual(['coalesced-model'])
  })

  it('keeps last-good/static state across failures and empty replies, with a forced retry escape hatch', async () => {
    let now = 0
    let mode: 'throw' | 'empty' | 'success' = 'throw'
    const list = vi.fn(async (): Promise<readonly CodexDiscoveredModel[]> => {
      if (mode === 'throw') throw new Error('codex unavailable')
      if (mode === 'empty') return []
      return [{ id: 'recovered-model' }]
    })
    const warn = vi.fn()
    const catalog = new CodexLiveCatalog({
      transport: { list },
      now: () => now,
      refreshIntervalMs: 10,
      installedModelIds: () => [],
      logger: { warn },
    })

    await expect(catalog.refresh(CODEX_PROVIDER, {})).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      'llm-pi-ai: Live Codex model refresh failed; keeping the last good/static catalog',
    )
    expect(warn).toHaveBeenCalledWith(expect.any(Error))

    now = 5
    await catalog.refresh(CODEX_PROVIDER, {})
    expect(list).toHaveBeenCalledTimes(1)

    mode = 'empty'
    await catalog.refresh(CODEX_PROVIDER, {}, true)
    expect(list).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith(
      'llm-pi-ai: Codex returned an empty live model catalog; keeping the last good/static catalog',
    )

    mode = 'success'
    await expect(catalog.refresh(CODEX_PROVIDER, {}, true)).resolves.toEqual(['recovered-model'])
    expect(catalog.revision).toBe(1)
  })

  it('covers silent diagnostics when no logger is installed', async () => {
    let mode: 'empty' | 'throw' = 'empty'
    const catalog = new CodexLiveCatalog({
      transport: {
        list: async () => {
          if (mode === 'throw') throw new Error('silent failure')
          return []
        },
      },
      now: () => 0,
      refreshIntervalMs: 10,
      installedModelIds: () => [],
    })

    await expect(catalog.refresh(CODEX_PROVIDER, {})).resolves.toBeUndefined()
    mode = 'throw'
    await expect(catalog.refresh(CODEX_PROVIDER, {}, true)).resolves.toBeUndefined()
  })

  it('supports production defaults without requiring them in tests', async () => {
    expect(new CodexLiveCatalog().revision).toBe(0)

    const catalog = new CodexLiveCatalog({
      transport: { list: async () => [{ id: 'default-options-model' }] },
    })
    await expect(catalog.refresh(CODEX_PROVIDER, {})).resolves.toEqual(['default-options-model'])
    expect(catalog.revision).toBe(1)
  })
})
