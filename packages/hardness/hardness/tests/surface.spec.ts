import { describe, expect, it } from 'vitest'
import { surfaceFromRoute } from '../src/surface.ts'
import type { CapabilityId, CapabilityRouteResult } from '../src/types.ts'

describe('HARDNESS capability surfaces', () => {
  it('projects only a route into stable serializable preview data', () => {
    const result = {
      kind: 'route',
      route: {
        need: { kind: 'calendar_invite' },
        capability: {
          id: 'tool:calendar' as CapabilityId,
          kind: 'calendar_invite',
          name: 'Calendar',
          description: 'Creates calendar invites.',
          inputs: ['event'],
          outputs: ['text/calendar'],
          dependencies: [],
          requiredPermissions: [{ kind: 'calendar.write', scope: 'user' }],
          provider: 'fixture',
          location: 'local',
          version: '1.0.0',
          compatibility: [],
          limitations: [],
          modalities: ['native'],
          status: 'verified',
        },
        modality: 'native',
        requiredPermissions: [{ kind: 'calendar.write', scope: 'user' }],
      },
    } as const satisfies CapabilityRouteResult

    const surface = surfaceFromRoute(result)
    expect(surface).toEqual({
      id: 'tool:calendar@1.0.0:native',
      need: { kind: 'calendar_invite' },
      capabilityId: 'tool:calendar',
      capabilityVersion: '1.0.0',
      modality: 'native',
      inputs: ['event'],
      outputs: ['text/calendar'],
      requiredPermissions: [{ kind: 'calendar.write', scope: 'user' }],
      verification: 'verified',
    })
    expect(JSON.parse(JSON.stringify(surface))).toEqual(surface)
    expect('execute' in surface).toBe(false)
  })

  it('does not create a surface for missing or unknown results', () => {
    expect(surfaceFromRoute({ kind: 'missing', considered: [], reasons: ['not verified'] })).toBeUndefined()
    expect(surfaceFromRoute({ kind: 'unknown', considered: [], reasons: ['not indexed'] })).toBeUndefined()
  })
})
