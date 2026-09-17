import { describe, expect, it, vi } from 'vitest'
import {
  OPENCODE_FREE_BASE_URL,
  OPENCODE_FREE_PROVIDER,
  createOpenCodeFreeCatalog,
  isOpenCodeFreeCandidate,
  opencodeFreeProfile,
  openCodeUpstreamHeaders,
  parseOpenCodeFreeModels,
} from '../src/opencode-free.ts'

describe('OpenCode free provider', () => {
  it('recognizes rotating free ids plus Big Pickle and excludes response-only contributor models', () => {
    expect(isOpenCodeFreeCandidate('mimo-v2.5-free')).toBe(true)
    expect(isOpenCodeFreeCandidate('deepseek-v4-flash-free')).toBe(true)
    expect(isOpenCodeFreeCandidate('big-pickle')).toBe(true)
    expect(isOpenCodeFreeCandidate('muse-spark-1.3-contributor-free')).toBe(false)
    expect(isOpenCodeFreeCandidate('gpt-5.6-sol')).toBe(false)
  })

  it('projects the live Zen catalog into a deduplicated Gratis selector list', () => {
    const models = parseOpenCodeFreeModels({
      data: [
        { id: 'gpt-5.6-sol' },
        { id: 'mimo-v2.5-free' },
        { id: 'big-pickle' },
        { id: 'mimo-v2.5-free' },
        { id: 'muse-spark-1.3-contributor-free' },
      ],
    })

    expect(models.map(model => model.id)).toEqual(['big-pickle', 'mimo-v2.5-free'])
    expect(models.every(model => model.name?.endsWith(' · Gratis'))).toBe(true)
  })

  it('keeps a zero-credential OpenAI-compatible route behind the Phoenix loopback proxy', () => {
    const profile = opencodeFreeProfile(parseOpenCodeFreeModels({ data: [{ id: 'big-pickle' }] }))
    expect(OPENCODE_FREE_PROVIDER).toBe('opencode-free')
    expect(profile.displayName).toContain('Gratis')
    expect(profile.apiKeyEnv).toBeUndefined()
    expect(profile.api).toBe('openai-completions')
    expect(profile.baseURL).not.toBe(OPENCODE_FREE_BASE_URL)
    expect(profile.headers?.Authorization).toBeTruthy()
  })

  it('keeps absent optional model fields absent when cloning selector entries', () => {
    const profile = opencodeFreeProfile([{ id: 'big-pickle' }])
    expect('input' in profile.models![0]!).toBe(false)
  })

  it('never forwards Phoenix local authorization to OpenCode', () => {
    const headers = openCodeUpstreamHeaders({
      authorization: 'Bearer phoenix-opencode-free',
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-phoenix-client': 'Phoenix',
      'x-multi': ['one', 'two'] as const,
    })
    expect(headers.authorization).toBeUndefined()
    expect(headers['content-type']).toBe('application/json')
    expect(headers.accept).toBe('text/event-stream')
    expect(headers['x-phoenix-client']).toBe('Phoenix')
    expect(headers['x-multi']).toBe('one, two')
  })

  it('refreshes from the public catalog and retains the last good list on failures', async () => {
    let now = 1_000
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 'big-pickle' }, { id: 'mimo-v2.5-free' }, { id: 'paid-model' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockRejectedValueOnce(new Error('offline'))

    const catalog = createOpenCodeFreeCatalog({
      fetchImpl,
      now: () => now,
      refreshMs: 100,
    })

    await catalog.refresh(true)
    expect(catalog.models().map(model => model.id)).toEqual(['big-pickle', 'mimo-v2.5-free'])

    now += 101
    await expect(catalog.refresh()).resolves.toBe(false)
    expect(catalog.models().map(model => model.id)).toEqual(['big-pickle', 'mimo-v2.5-free'])
  })
})
