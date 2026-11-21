import { describe, expect, it } from 'vitest'
import { ADAPTIVE_MISSION_EVENT, isAdaptiveMissionEvent, newAdaptiveAppMission } from '../src/client/adaptive-app-mission.ts'

describe('App Studio conversation mission', () => {
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
