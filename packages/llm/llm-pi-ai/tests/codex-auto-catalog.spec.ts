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

  it('retains exact live reasoning metadata and revisions when only capabilities change', async () => {
    let now = 0
    let next: CodexDiscoveredModel[] = [{
      id: 'future-reasoner',
      reasoning: {
        efforts: [{ id: 'low', name: 'Low', description: 'Fast' }],
        defaultEffort: 'low',
      },
    }]
    const catalog = new CodexLiveCatalog({
      transport: { list: async () => next },
      now: () => now,
      refreshIntervalMs: 10,
      installedModelIds: () => [],
    })

    await catalog.refresh(CODEX_PROVIDER, {})
    expect(catalog.revision).toBe(1)
    expect(catalog.reasoningForModel('future-reasoner')).toEqual({
      efforts: [{ id: 'low', name: 'Low', description: 'Fast' }],
      defaultEffort: 'low',
    })

    // "ultra" is outside pi-ai 0.82's fixed internal vocabulary. The model
    // profile is otherwise unchanged, so this proves exact Codex metadata has
    // its own revision signal instead of being discarded by profile projection.
    next = [{
      id: 'future-reasoner',
      reasoning: {
        efforts: [
          { id: 'low', name: 'Low', description: 'Fast' },
          { id: 'ultra', name: 'Ultra', description: 'Maximum Codex reasoning' },
        ],
        defaultEffort: 'ultra',
      },
    }]
    now = 11
    await catalog.refresh(CODEX_PROVIDER, {})

    expect(catalog.revision).toBe(2)
    expect(catalog.reasoningForModel('future-reasoner')).toEqual({
      efforts: [
        { id: 'low', name: 'Low', description: 'Fast' },
        { id: 'ultra', name: 'Ultra', description: 'Maximum Codex reasoning' },
      ],
      defaultEffort: 'ultra',
    })
  })

  it('gives a future-only Codex reasoner a hidden pi-ai carrier level', () => {
    expect(codexModelsToProfiles([{
      id: 'future-only',
      reasoning: {
        efforts: [{ id: 'ultra', name: 'Ultra' }],
        defaultEffort: 'ultra',
      },
    }])).toEqual([{
      id: 'future-only',
      reasoningEfforts: { high: 'ultra' },
    }])
  })

  it('refreshes live metadata for pinned Codex rows without changing their selected ids', async () => {
    const list = vi.fn(async (): Promise<readonly CodexDiscoveredModel[]> => [{
      id: 'gpt-6-luna',
      name: 'GPT-6 Luna',
      reasoning: {
        efforts: [
          { id: 'low', name: 'Low' },
          { id: 'medium', name: 'Medium' },
          { id: 'high', name: 'High' },
          { id: 'xhigh', name: 'Extra High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'medium',
      },
    }, {
      id: 'gpt-6-astra',
      name: 'GPT-6 Astra',
      reasoning: {
        efforts: [{ id: 'high', name: 'High' }],
        defaultEffort: 'high',
      },
    }])
    const catalog = new CodexLiveCatalog({
      transport: { list },
      now: () => 0,
      refreshIntervalMs: 10,
      installedModelIds: () => [],
    })
    const pinned = {
      [CODEX_PROVIDER]: {
        models: [
          { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' },
          { id: 'gpt-6-luna', name: 'GPT-6 Luna' },
        ],
      },
    }

    await expect(catalog.refresh(CODEX_PROVIDER, pinned[CODEX_PROVIDER]))
      .resolves.toEqual(['gpt-5.6-luna', 'gpt-6-luna'])
    expect(list).toHaveBeenCalledOnce()
    expect(catalog.reasoningForModel('gpt-6-luna')).toEqual({
      efforts: [
        { id: 'low', name: 'Low' },
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
        { id: 'xhigh', name: 'Extra High' },
        { id: 'max', name: 'Max' },
      ],
      defaultEffort: 'medium',
    })

    const overlaid = catalog.overlayProviders(pinned)[CODEX_PROVIDER]
    expect(overlaid?.models?.map(model => model.id)).toEqual(['gpt-5.6-luna', 'gpt-6-luna'])
    expect(overlaid?.models?.[1]).toMatchObject({
      id: 'gpt-6-luna',
      reasoningEfforts: {
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
    })
  })

  it('refreshes immediately when Settings pins a newly discovered model inside the normal TTL', async () => {
    let now = 0
    let next: CodexDiscoveredModel[] = [{ id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' }]
    const list = vi.fn(async () => next)
    const catalog = new CodexLiveCatalog({
      transport: { list },
      now: () => now,
      refreshIntervalMs: 60_000,
      installedModelIds: () => [],
    })

    await catalog.refresh(CODEX_PROVIDER, {})
    expect(list).toHaveBeenCalledTimes(1)

    next = [{
      id: 'gpt-6-luna',
      name: 'GPT-6 Luna',
      reasoning: {
        efforts: [
          { id: 'low', name: 'Low' },
          { id: 'medium', name: 'Medium' },
          { id: 'high', name: 'High' },
          { id: 'xhigh', name: 'Extra High' },
          { id: 'max', name: 'Max' },
        ],
        defaultEffort: 'medium',
      },
    }]
    now = 1
    const pinned = { models: [{ id: 'gpt-6-luna', name: 'GPT-6 Luna' }] }

    await expect(catalog.refresh(CODEX_PROVIDER, pinned)).resolves.toEqual(['gpt-6-luna'])
    expect(list).toHaveBeenCalledTimes(2)
    expect(catalog.reasoningForModel('gpt-6-luna')?.defaultEffort).toBe('medium')
  })

  it('keeps explicit reasoning disablement on a pinned Codex row', async () => {
    const catalog = new CodexLiveCatalog({
      transport: {
        list: async () => [{
          id: 'gpt-6-luna',
          reasoning: {
            efforts: [{ id: 'high', name: 'High' }],
            defaultEffort: 'high',
          },
        }],
      },
      now: () => 0,
      refreshIntervalMs: 10,
      installedModelIds: () => [],
    })
    const pinned = {
      [CODEX_PROVIDER]: {
        models: [{ id: 'gpt-6-luna', reasoningEfforts: false as const }],
      },
    }

    await catalog.refresh(CODEX_PROVIDER, pinned[CODEX_PROVIDER])
    expect(catalog.overlayProviders(pinned)[CODEX_PROVIDER]?.models?.[0]?.reasoningEfforts).toBe(false)
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

    expect(catalog.overlayProviders(automatic)).toBe(automatic)
    expect(await catalog.refresh('not-codex', {})).toBeUndefined()
    expect(list).not.toHaveBeenCalled()

    await expect(catalog.refresh(CODEX_PROVIDER, automatic[CODEX_PROVIDER]))
      .resolves.toEqual(['new-live-model', 'second-live-model'])
    expect(catalog.revision).toBe(1)
    expect(catalog.overlayProviders(automatic)[CODEX_PROVIDER]?.models?.map(model => model.id))
      .toEqual(['installed-only', 'new-live-model', 'second-live-model'])

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
