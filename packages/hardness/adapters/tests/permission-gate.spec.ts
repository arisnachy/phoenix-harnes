import { describe, expect, it } from 'vitest'
import { PermissionGate } from '../src/permission-gate.ts'
import type { CapabilitySurface } from '@deepseek-ai/dsh-hardness'

const surface = {
  id: 'tool:calendar@1.0.0:visual',
  need: { kind: 'calendar_invite' },
  capabilityId: 'tool:calendar',
  capabilityVersion: '1.0.0',
  modality: 'visual',
  inputs: ['event'],
  outputs: ['text/calendar'],
  requiredPermissions: [{ kind: 'calendar.write', scope: 'user' }],
  verification: 'verified',
} as const satisfies CapabilitySurface

describe('HARDNESS permission gate', () => {
  it('approves only when every declared permission has an explicit grant', () => {
    const gate = new PermissionGate()
    expect(gate.evaluate(surface, ['calendar.write:user'])).toEqual({ kind: 'approved' })
    expect(gate.evaluate(surface, [])).toEqual({ kind: 'denied', missing: ['calendar.write:user'] })
  })
})
