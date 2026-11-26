import { describe, expect, it } from 'vitest'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { projectAntigravitySelector } from '../src/client/antigravity-visibility.ts'

const legacy = { id: 'google-account', name: 'Google Antigravity CLI', models: [
  { id: 'gemini-a', name: 'Legacy A' }, { id: 'gemini-b', name: 'Gemini B' },
] }
const primary = { id: 'google-antigravity', name: 'Google Antigravity CLI', models: [
  { id: 'gemini-a', name: 'Gemini A' },
] }
const google = { id: 'google', name: 'Google', models: [{ id: 'gemini-a', name: 'Gemini A' }] }
const state: ModelDirectoryState = {
  current: { provider: 'google-account', model: 'gemini-a' },
  routable: true, groups: [google, legacy, primary], failures: [], status: 'ready', error: null,
}

describe('Antigravity selector alias projection', () => {
  it('shows one Antigravity provider, unique models and the independent Google API provider', () => {
    const projected = projectAntigravitySelector(state)
    expect(projected.groups.map(group => group.id)).toEqual(['google', 'google-antigravity'])
    expect(projected.groups[1]?.models).toEqual([
      { id: 'gemini-a', name: 'Gemini A' }, { id: 'gemini-b', name: 'Gemini B' },
    ])
    expect(projected.current).toEqual({ provider: 'google-antigravity', model: 'gemini-a' })
    expect(state.current?.provider).toBe('google-account')
    expect(state.groups).toHaveLength(3)
  })
  it('preserves a usable legacy-only catalog and does not fabricate routes', () => {
    const legacyOnly = { ...state, groups: [google, legacy] }
    expect(projectAntigravitySelector(legacyOnly)).toBe(legacyOnly)
  })
  it('does not depend on provider order or change other model selections', () => {
    const other = { ...state, current: { provider: 'google', model: 'gemini-a' }, groups: [primary, google, legacy] }
    const projected = projectAntigravitySelector(other)
    expect(projected.current).toBe(other.current)
    expect(projected.groups.map(group => group.id)).toEqual(['google-antigravity', 'google'])
  })
})
