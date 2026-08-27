import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HardnessRegistry from '../src/index.ts'
import type { CapabilityDescriptor, CapabilityId, HardnessService } from '../src/types.ts'

const id = 'tool:calendar-ics' as CapabilityId

function descriptor(version = '1.0.0'): CapabilityDescriptor {
  return {
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
    version,
    compatibility: ['calendar_event→text/calendar'],
    limitations: [],
    modalities: ['native'],
    status: 'experimental',
  }
}

describe('HARDNESS capability registry', () => {
  it('validates descriptors, replaces only newer versions, and guards lifecycle promotion', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const service = ctx.get('hardness') as HardnessService | undefined
    if (service === undefined) throw new Error('hardness service missing')

    expect(() => service.register({ ...descriptor(), id: '' as CapabilityId })).toThrow(/descriptor/i)
    expect(service.list()).toEqual([])

    service.register(descriptor('1.0.0'))
    expect(() => service.register(descriptor('0.9.0'))).toThrow(/version/i)
    service.register(descriptor('1.1.0'))
    expect(service.get(id)?.version).toBe('1.1.0')
    expect(() => { service.transition(id, 'verified', 'manual') }).toThrow(/evidence/i)

    await ctx.fiber.dispose()
  })
})
