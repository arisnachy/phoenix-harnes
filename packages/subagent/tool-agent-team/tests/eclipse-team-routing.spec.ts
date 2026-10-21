import { describe, expect, it } from 'vitest'
import { resolveEclipseTeammateProfile } from '../src/index.ts'

describe('Eclipse teammate overrides', () => {
  const fallback = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' }
  it('preserves the original worker when no settings or automatic mode', () => {
    expect(resolveEclipseTeammateProfile(undefined, 'orion', fallback)).toEqual(fallback)
    expect(resolveEclipseTeammateProfile({ mode: 'automatic', subagent: { provider: 'mock', model: 'new' } },
      'orion', fallback)).toEqual(fallback)
  })
  it('applies one configured subagent route to every teammate identity', () => {
    const config = {
      mode: 'hybrid' as const,
      subagent: { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'medium' },
      specialists: { orion: { provider: 'openrouter', model: 'deep-research', reasoningEffort: 'high' } },
    }
    expect(resolveEclipseTeammateProfile(config, 'atlas', fallback)?.model).toBe('gpt-6-luna')
    expect(resolveEclipseTeammateProfile(config, 'orion', fallback)?.model).toBe('gpt-6-luna')
  })

  it('adapts an omitted hybrid effort while manual mode keeps provider default', () => {
    const hybrid = { mode: 'hybrid' as const, subagent: { provider: 'openai-codex', model: 'gpt-6-astra' } }
    expect(resolveEclipseTeammateProfile(hybrid, 'atlas', fallback, 'xhigh')).toEqual({
      provider: 'openai-codex', model: 'gpt-6-astra', reasoningEffort: 'xhigh',
    })
    const manual = { mode: 'manual' as const, subagent: { provider: 'openai-codex', model: 'gpt-6-astra' } }
    expect(resolveEclipseTeammateProfile(manual, 'atlas', fallback, 'xhigh')).toEqual(manual.subagent)
  })

  it('does not inherit a preset Max effort for an automatic hybrid child', () => {
    const preset = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' }
    expect(resolveEclipseTeammateProfile({ mode: 'hybrid' }, 'atlas', preset, 'high')).toEqual({
      provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'high',
    })
  })

  it('rejects a non-Codex persisted subagent route', () => {
    const config = { mode: 'manual' as const, subagent: { provider: 'openrouter', model: 'legacy-worker' } }
    expect(resolveEclipseTeammateProfile(config, 'atlas', fallback)).toEqual(fallback)
  })

  it('does not dispatch the virtual Eclipse selector as a child model', () => {
    const config = { mode: 'manual' as const, subagent: { provider: 'openai-codex', model: 'phoenix-auto' } }
    expect(resolveEclipseTeammateProfile(config, 'atlas', fallback)).toEqual(fallback)
  })
})
