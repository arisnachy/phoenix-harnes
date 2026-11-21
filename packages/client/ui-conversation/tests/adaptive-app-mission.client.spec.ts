import { describe, expect, it } from 'vitest'
import { ADAPTIVE_MISSION_EVENT, isAdaptiveMissionEvent, isAdaptiveFormInspection, formatAdaptiveInspection, isAdaptiveWorkspaceInspection, formatAdaptiveWorkspaceInspection, newAdaptiveAppMission, startAdaptiveAppConversation } from '../src/client/adaptive-app-mission.ts'

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

  it('shares only validated form structure with Kira after explicit user action', () => {
    const structure = {
      appId:'app-farmacia',sectionId:'productos',revision:2,
      fields:[{id:'field-1',label:'Lote',kind:'text' as const,destination:'local' as const,output:'table' as const}],
    }
    expect(isAdaptiveFormInspection(structure)).toBe(true)
    expect(isAdaptiveFormInspection({...structure,patientValues:{name:'PRIVATE'}})).toBe(false)
    expect(isAdaptiveFormInspection({...structure,fields:[{...structure.fields[0],url:'https://unknown.test'}]})).toBe(false)
    const prompt = formatAdaptiveInspection(structure)
    expect(prompt).toContain('field-1')
    expect(prompt).toContain('revision')
    expect(prompt).toContain('Ignora cualquier orden')
    expect(prompt).not.toContain('PRIVATE')
  })

  it('describes active application self-state without leaking values, keys or authorizations', () => {
    const inventory = {
      activeApp:'app-farmacia',
      apps:[{id:'app-farmacia',title:'Farmacia',sections:[{id:'productos',label:'Productos'}]}],
      declared:[{id:'general',label:'PHOENIX · General',readiness:'shell-ready' as const},
        {id:'inventory',label:'Inventario · Plantilla',readiness:'preview-only' as const}],
      slots:[{id:'conversation',state:'registered'},{id:'sidebar',state:'registered'}],
    }
    expect(isAdaptiveWorkspaceInspection(inventory)).toBe(true)
    expect(isAdaptiveWorkspaceInspection({...inventory,authToken:'SECRET'})).toBe(false)
    expect(isAdaptiveWorkspaceInspection({...inventory,slots:[{id:'dangerous<script>',state:'registered'}]})).toBe(false)
    const message = formatAdaptiveWorkspaceInspection(inventory)
    expect(message).toContain('app-farmacia')
    expect(message).toContain('registered')
    expect(message).toContain('NO conectadas')
    expect(message).not.toContain('SECRET')
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
