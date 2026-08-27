import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import HardnessRegistry from '../src/index.ts'
import type { CapabilityDescriptor, CapabilityEvidence, CapabilityId, HardnessService } from '../src/types.ts'

const need = { kind: 'calendar_invite', inputs: ['event'], outputs: ['text/calendar'] }
const descriptor: CapabilityDescriptor = {
  id: 'fixture:calendar-invite' as CapabilityId,
  kind: 'calendar_invite',
  name: 'Calendar invite fixture',
  description: 'Produces one iCalendar invitation.',
  inputs: ['event'],
  outputs: ['text/calendar'],
  dependencies: [],
  requiredPermissions: [],
  provider: 'fixture',
  location: 'local',
  version: '1.0.0',
  compatibility: [],
  limitations: [],
  modalities: ['native'],
  status: 'experimental',
}

const passedEvidence: CapabilityEvidence = {
  id: 'evidence:calendar-invite', capabilityId: descriptor.id, descriptorVersion: '1.0.0', caseId: 'calendar-invite-proof',
  inputSummary: '{ event: sample }', outcome: 'passed', durationMs: 3, artifactRefs: ['artifact:invite.ics'],
}

describe('HARDNESS unknown need end to end', () => {
  it('keeps an unenumerated need honest until verified capability exists', async () => {
    const first = new Context()
    await first.plugin(HardnessRegistry)
    const service = first.get('hardness') as HardnessService | undefined
    if (service === undefined) throw new Error('hardness service missing')

    expect(service.resolveNeed(need).kind).toBe('unknown')
    service.register(descriptor)
    expect(service.resolveNeed(need).kind).toBe('missing')
    const evidence = service.recordEvidence(passedEvidence)
    service.promoteFromEvidence(evidence.id)
    expect(service.resolveNeed(need).kind).toBe('have')

    const second = new Context()
    await second.plugin(HardnessRegistry)
    const restored = second.get('hardness') as HardnessService | undefined
    if (restored === undefined) throw new Error('restored hardness service missing')
    restored.restore(service.snapshot())
    expect(restored.resolveNeed(need).kind).toBe('have')
    await first.fiber.dispose()
    await second.fiber.dispose()
  })
})
