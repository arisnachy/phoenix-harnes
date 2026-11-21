import { describe, expect, it } from 'vitest'
import { ADAPTIVE_MISSION_EVENT, isAdaptiveMissionEvent, newAdaptiveAppMission, startAdaptiveAppConversation } from '../src/client/adaptive-app-mission.ts'

describe('App Studio conversation mission', () => {
  it('creates a Host session in the current workspace and submits through the normal input', async () => {
    const calls: string[] = []
    const id = await startAdaptiveAppConversation({
      current: () => 'old-session',
      workspaces: () => ({ items: [{ workspaceId: 'phoenix', sessionIds: ['old-session'] }], recentWorkspaceId: 'other' }),
      create: async options => { calls.push('create:' + String(options.workspaceId)); return 'app-session' },
      open: session => { calls.push('open:' + session) },
      input: session => ({
        setDraft: prompt => { calls.push('draft:' + session); expect(prompt).toContain('Quiero crear una nueva aplicación') },
        submit: () => { calls.push('submit') },
      }),
    })
    expect(id).toBe('app-session')
    expect(calls).toEqual(['create:phoenix', 'open:app-session', 'draft:app-session', 'submit'])
  })

  it('does not submit a mission if Host creation fails', async () => {
    let submitted = false
    await expect(startAdaptiveAppConversation({
      current: () => undefined,
      workspaces: () => ({ items: [] }),
      create: async () => { throw new Error('HOST_UNAVAILABLE') },
      open: () => { throw new Error('must not open') },
      input: () => ({ setDraft: () => {}, submit: () => { submitted = true } }),
    })).rejects.toThrow('HOST_UNAVAILABLE')
    expect(submitted).toBe(false)
  })

  it('accepts only the explicit fixed app-creation intent', () => {
    expect(ADAPTIVE_MISSION_EVENT).toBe('phoenix:adaptive-app-mission')
    expect(isAdaptiveMissionEvent({ intent: 'new-app' })).toBe(true)
    expect(isAdaptiveMissionEvent({ intent: 'new-app', patientName: 'Private' })).toBe(false)
    expect(isAdaptiveMissionEvent({ intent: 'delete-repo' })).toBe(false)
    expect(isAdaptiveMissionEvent('new-app')).toBe(false)
    expect(isAdaptiveMissionEvent(null)).toBe(false)
  })

  it('plans with the user, verifies installed capabilities, requires approval and keeps rollback', () => {
    const mission = newAdaptiveAppMission()
    expect(mission).toContain('Sol planifica')
    expect(mission).toContain('Luna ejecuta')
    expect(mission).toContain('capacidades activas')
    expect(mission).toContain('Pearl Light')
    expect(mission).toContain('aprobación')
    expect(mission).toContain('último estado correcto')
    expect(mission).toContain('datos clínicos')
    expect(mission).toContain('Comienza preguntándome')
  })
})
