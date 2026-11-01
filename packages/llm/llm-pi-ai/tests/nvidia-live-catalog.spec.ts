import { describe, expect, it, vi } from 'vitest'
import { resolveProfiles } from '../src/config.ts'
import {
  NvidiaLiveCatalog,
  NVIDIA_BUILD_BASE_URL,
  nvidiaChatCandidate,
  parseNvidiaChatModels,
} from '../src/nvidia-live-catalog.ts'

const listing = (...ids: string[]): Response =>
  new Response(JSON.stringify({ object: 'list', data: ids.map(id => ({ id, object: 'model' })) }), {
    status: 200, headers: { 'content-type': 'application/json' },
  })

describe('NVIDIA dynamic catalog', () => {
  it('reads the public hosted listing and excludes non-chat NVIDIA endpoints', () => {
    expect(parseNvidiaChatModels({
      data: [
        { id: 'minimaxai/minimax-m3.1-flash' },
        { id: 'nvidia/nemotron-3.5-super-vl-120b-a12b' },
        { id: 'nvidia/nemotron-3.5-embed-1b' },
        { id: 'nvidia/nemotron-parse-2.0' },
        { id: 'nvidia/nemotron-3.5-embed-1b' },
        { id: 'minimaxai/minimax-m3.1-flash' },
        { id: '../unsafe' },
        { id: null },
      ],
    }).map(model => model.id)).toEqual([
      'minimaxai/minimax-m3.1-flash',
      'nvidia/nemotron-3.5-super-vl-120b-a12b',
    ])
    expect(nvidiaChatCandidate('nvidia/llama-3.1-nemotron-ultra-253b-v1')).toBe(true)
    expect(nvidiaChatCandidate('nvidia/nemotron-3.5-embed-8b')).toBe(false)
  })

  it('learns new model IDs and hides retired models automatically on a cached refresh', async () => {
    let now = 1_000
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(listing('minimaxai/minimax-m3', 'nvidia/nemotron-3-super-120b-a12b'))
      .mockResolvedValueOnce(listing('minimaxai/minimax-m3.1-flash', 'nvidia/nemotron-3-super-120b-a12b'))
    const catalog = new NvidiaLiveCatalog({ fetchImpl, now: () => now, refreshMs: 1_000 })
    const pinned = { nvidia: { models: [{ id: 'minimaxai/minimax-m3', name: 'Legacy M3' }] } }
    expect(catalog.visibleIds()).toBeUndefined()

    await catalog.refresh()
    expect(fetchImpl).toHaveBeenCalledWith(`${NVIDIA_BUILD_BASE_URL}/models`, expect.objectContaining({ method: 'GET' }))
    const initial = catalog.revision
    await catalog.refresh()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    now += 1_001
    await catalog.refresh()
    expect(catalog.revision).toBeGreaterThan(initial)
    expect(catalog.visibleIds()).toEqual([
      'minimaxai/minimax-m3.1-flash',
      'nvidia/nemotron-3-super-120b-a12b',
    ])
    const runtime = resolveProfiles(catalog.overlayProviders(pinned)).get('nvidia')
    expect(runtime?.piProvider.getModels().some(model => model.id === 'minimaxai/minimax-m3')).toBe(true)
    expect(runtime?.piProvider.getModels().some(model => model.id === 'minimaxai/minimax-m3.1-flash')).toBe(true)
    expect(catalog.preferredModel('minimaxai/minimax-m3')).toBe('minimaxai/minimax-m3.1-flash')
    expect(pinned.nvidia.models).toEqual([{ id: 'minimaxai/minimax-m3', name: 'Legacy M3' }])
  })

  it('quarantines a 410 and prefers the same publisher without repeatedly calling retired models', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      listing('minimaxai/minimax-m3', 'minimaxai/minimax-m3.1-flash', 'nvidia/nemotron-3-super-120b-a12b'),
    )
    let now = 5_000
    const catalog = new NvidiaLiveCatalog({ fetchImpl, now: () => now })
    await catalog.refresh()
    expect(catalog.preferredModel('minimaxai/minimax-m3')).toBeUndefined()
    const replacement = await catalog.markUnavailable('minimaxai/minimax-m3')
    expect(replacement).toBe('minimaxai/minimax-m3.1-flash')
    expect(catalog.visibleIds()).not.toContain('minimaxai/minimax-m3')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    now += 60 * 60_000 + 1
    expect(catalog.visibleIds()).toContain('minimaxai/minimax-m3')
  })

  it('retains the last good catalog when NVIDIA times out or returns an invalid listing', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(listing('minimaxai/minimax-m3.1-flash'))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(listing())
    const catalog = new NvidiaLiveCatalog({ fetchImpl, now: () => 1_000, failureRetryMs: 1 })
    await catalog.refresh(true)
    const generation = catalog.revision
    await catalog.refresh(true)
    await catalog.refresh(true)
    expect(catalog.visibleIds()).toEqual(['minimaxai/minimax-m3.1-flash'])
    expect(catalog.revision).toBe(generation)
  })

  it('coalesces simultaneous callers into one listing request', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(listing('minimaxai/minimax-m3.1-flash'))
    const catalog = new NvidiaLiveCatalog({ fetchImpl })
    const [a, b] = await Promise.all([catalog.refresh(true), catalog.refresh(true)])
    expect(a).toEqual(b)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not guess a vision-capable replacement when only unknown text model metadata is available', async () => {
    const catalog = new NvidiaLiveCatalog({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(listing('unknown/new-text-model')),
    })
    await catalog.refresh()
    expect(catalog.preferredModel('minimaxai/minimax-m3', true)).toBeUndefined()
    expect(catalog.preferredModel('minimaxai/minimax-m3', false)).toBe('unknown/new-text-model')
  })
})
