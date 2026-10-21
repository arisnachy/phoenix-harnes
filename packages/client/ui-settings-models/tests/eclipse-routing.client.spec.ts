import { describe, expect, it } from 'vitest'
import { existingProfile } from '../src/client/EclipseRoutingPanel.tsx'

describe('Eclipse model settings', () => {
  it('uses independent Eclipse namespace rather than Agent defaults', () => {
    const agentDefault = { provider: 'openai-codex', model: 'gpt-6-luna' }
    const eclipse = {
      mode: 'hybrid',
      planner: { provider: 'openai-codex', model: 'gpt-6.1-sol', reasoningEffort: 'medium' },
    }
    expect(existingProfile(eclipse, agentDefault)).toEqual(eclipse)
    expect(existingProfile(eclipse, agentDefault)).not.toHaveProperty('provider')
  })

  it('migrates legacy Eclipse settings until the new section is saved', () => {
    const old = { eclipse: { mode: 'manual', coordinator: { provider: 'mock', model: 'lead' } } }
    expect(existingProfile({}, old)).toEqual(old.eclipse)
    expect(existingProfile({ mode: 'automatic' }, old)).toEqual({ mode: 'automatic' })
    expect(existingProfile(undefined, {})).toEqual({ mode: 'automatic', maxTeammates: 3 })
  })
})
