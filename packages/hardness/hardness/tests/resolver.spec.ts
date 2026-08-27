import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HardnessRegistry from '../src/index.ts'
import type { CapabilityDescriptor, CapabilityId, HardnessService } from '../src/types.ts'

const id = 'tool:calendar-ics' as CapabilityId

const descriptor: CapabilityDescriptor = {
  id,
  kind: 'tool',
  name: 'Calendar invite generator',
  description: 'Generates an iCalendar invite.',
  inputs: ['calendar_event'],
  outputs: ['text/calendar'],
  dependencies: [],
  requiredPermissions: [],
  provider: 'fixture',
  location: 'local',
  version: '1.0.0',
  compatibility: ['calendar_event→text/calendar'],
  limitations: [],
  status: 'verified',
}

const restricted: CapabilityDescriptor = {
  ...descriptor,
  id: 'tool:restricted' as CapabilityId,
  requiredPermissions: [{ kind: 'network', scope: 'calendar.example' }],
}

describe('HARDNESS capability resolver', () => {
  it('returns have, missing, and unknown without selecting unsafe candidates', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const service = ctx.get('hardness') as HardnessService | undefined
    if (service === undefined) throw new Error('hardness service missing')
    service.register(descriptor)
    service.register(restricted)

    const available = service.resolveNeed({ kind: 'tool', inputs: ['calendar_event'], outputs: ['text/calendar'] })
    expect(available.kind).toBe('have')
    expect(available.capability?.id).toBe(id)

    const missingInput = service.resolveNeed({ kind: 'tool', inputs: ['missing_input'] })
    expect(missingInput.kind).toBe('missing')
    expect(missingInput.reasons.some(reason => /input/i.test(reason))).toBe(true)

    const unknown = service.resolveNeed({ kind: 'future-format' })
    expect(unknown.kind).toBe('unknown')
    expect(unknown.reasons.some(reason => /class|kind|unknown/i.test(reason))).toBe(true)

    const missingPermission = service.resolveNeed({ kind: 'tool', permissions: ['filesystem'] })
    expect(missingPermission.kind).toBe('missing')
    expect(missingPermission.reasons.some(reason => /permission/i.test(reason))).toBe(true)

    await ctx.fiber.dispose()
  })
})
