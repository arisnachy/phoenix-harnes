import { describe, expect, it } from 'vitest'
import { resolveEclipseTeammateProfile } from '../src/index.ts'

describe('Eclipse teammate overrides', () => {
  const fallback = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' }
  it('preserves the original worker when no settings or automatic mode', () => {
    expect(resolveEclipseTeammateProfile(undefined, 'orion', fallback)).toEqual(fallback)
    expect(resolveEclipseTeammateProfile({ mode: 'automatic', subagent: { provider: 'mock', model: 'new' } },
      'orion', fallback)).toEqual(fallback)
  })
  it('applies the default worker and honors the named specialist', () => {
    const config = {
      mode: 'hybrid' as const,
      subagent: { provider: 'deepseek', model: 'coder', reasoningEffort: 'medium' },
      specialists: { orion: { provider: 'openrouter', model: 'deep-research', reasoningEffort: 'high' } },
    }
    expect(resolveEclipseTeammateProfile(config, 'atlas', fallback)?.model).toBe('coder')
    expect(resolveEclipseTeammateProfile(config, 'orion', fallback)?.model).toBe('deep-research')
  })
})
