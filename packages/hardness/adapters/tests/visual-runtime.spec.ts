import { describe, expect, it } from 'vitest'
import { VisualToolRuntime } from '../src/visual-runtime.ts'
import type { CapabilityId, CapabilitySurface } from '@phoenix-ai/dsh-hardness'

const surface = {
  id: 'tool:calendar@1.0.0:visual',
  need: { kind: 'calendar_invite' },
  capabilityId: 'tool:calendar' as CapabilityId,
  capabilityVersion: '1.0.0',
  modality: 'visual',
  inputs: ['event'],
  outputs: ['text/calendar'],
  requiredPermissions: [],
  verification: 'verified',
} as const satisfies CapabilitySurface

describe('HARDNESS visual tool runtime', () => {
  it('selects a registered renderer and disposes it reversibly', () => {
    const runtime = new VisualToolRuntime()
    const dispose = runtime.register('visual', current => ({ kind: 'preview', surfaceId: current.id }))
    expect(runtime.render(surface)).toEqual({ kind: 'preview', surfaceId: surface.id })
    dispose()
    expect(runtime.render(surface)).toBeUndefined()
  })

  it('never renders a non-visual modality through visual runtime', () => {
    const runtime = new VisualToolRuntime()
    runtime.register('visual', current => ({ kind: 'preview', surfaceId: current.id }))
    expect(runtime.render({ ...surface, modality: 'native' })).toBeUndefined()
  })
})
