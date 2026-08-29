import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@phoenix-ai/dsh-client-runtime/client'
import { registerCapabilitySurfacePreview } from '@phoenix-ai/dsh-client-ui-workspace/client'
import type { CapabilityId, CapabilitySurface } from '@phoenix-ai/dsh-hardness'

const surface = {
  id: 'tool:calendar@1.0.0:native',
  need: { kind: 'calendar_invite' },
  capabilityId: 'tool:calendar' as CapabilityId,
  capabilityVersion: '1.0.0',
  modality: 'native',
  inputs: ['event'],
  outputs: ['text/calendar'],
  requiredPermissions: [{ kind: 'calendar.write', scope: 'user' }],
  verification: 'verified',
} as const satisfies CapabilitySurface

describe('CapabilitySurface preview slot', () => {
  it('registers and removes a declaration without an execution face', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    const disposeDeclaration = slots.register({
      name: 'root',
      children: { 'capability.surface.preview': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    const disposePreview = registerCapabilitySurfacePreview(slots, surface)
    const entry = slots.entries('capability.surface.preview')[0]!
    expect(entry.options.id).toBe(surface.id)
    expect(entry.component).toBeDefined()
    expect((entry.inject as () => { surface: CapabilitySurface })().surface).toEqual(surface)
    expect('execute' in entry).toBe(false)
    disposePreview()
    expect(slots.entries('capability.surface.preview')).toHaveLength(0)
    disposeDeclaration()
  })
})
