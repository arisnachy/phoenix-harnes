import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import HardnessRegistry from '../src/index.ts'
import type { CapabilityDescriptor, CapabilityId, HardnessService } from '../src/types.ts'

const id = 'tool:visual-calendar' as CapabilityId
const descriptor: CapabilityDescriptor = {
  id,
  kind: 'calendar_invite',
  name: 'Visual calendar invite',
  description: 'Creates an invite preview.',
  inputs: ['event'],
  outputs: ['text/calendar'],
  dependencies: [],
  requiredPermissions: [],
  provider: 'fixture',
  location: 'local',
  version: '1.0.0',
  compatibility: [],
  limitations: [],
  modalities: ['native', 'visual'],
  status: 'verified',
}

describe('HARDNESS declarative capability router', () => {
  it('selects a requested modality and preserves honest non-route results', async () => {
    const context = new Context()
    await context.plugin(HardnessRegistry)
    const service = context.get('hardness') as HardnessService | undefined
    if (service === undefined) throw new Error('hardness service missing')
    service.register(descriptor)

    const visual = service.route({ kind: 'calendar_invite', inputs: ['event'], outputs: ['text/calendar'] }, { modalities: ['visual'] })
    expect(visual.kind).toBe('route')
    if (visual.kind === 'route') {
      expect(visual.route.modality).toBe('visual')
      expect(visual.route.capability.id).toBe(id)
      expect(visual.route.need.kind).toBe('calendar_invite')
      expect(visual.route.requiredPermissions).toEqual([])
      expect('execute' in visual).toBe(false)
    }

    expect(service.route({ kind: 'calendar_invite' }, { modalities: ['workspace'] }).kind).toBe('missing')
    expect(service.route({ kind: 'not-registered' }, { modalities: ['native'] }).kind).toBe('unknown')
    await context.fiber.dispose()
  })
})
