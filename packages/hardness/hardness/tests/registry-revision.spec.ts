import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import HardnessRegistry from '../src/index.ts'
import type { CapabilityDescriptor, CapabilityId, HardnessService } from '../src/types.ts'

const id = 'openclaw:resume-revision' as CapabilityId

function descriptor(version: string, description = 'old projection'): CapabilityDescriptor {
  return {
    id,
    kind: 'extension',
    name: 'OpenClaw resume projection',
    description,
    inputs: [],
    outputs: ['extension'],
    dependencies: [],
    requiredPermissions: [],
    provider: 'openclaw',
    location: 'extensions/resume-revision',
    version,
    compatibility: ['phoenix:openclaw-compat-v1'],
    limitations: ['experimental'],
    modalities: ['native'],
    status: 'experimental',
  }
}

describe('HARDNESS descriptor revisions', () => {
  it('replaces a stale lower revision during resume and keeps both lifecycles safe', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const service = ctx.get('hardness') as HardnessService

    const stale = service.register(descriptor('2026.8.1'))
    const current = service.register(descriptor('2026.8.2', 'current projection'))

    expect(service.get(id)?.version).toBe('2026.8.2')
    expect(service.get(id)?.description).toBe('current projection')

    stale.dispose()
    expect(service.get(id)?.version).toBe('2026.8.2')
    current.dispose()
    expect(service.get(id)).toBeUndefined()

    await ctx.fiber.dispose()
  })

  it('reports the capability id and changed fields for an unsafe same-version rewrite', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const service = ctx.get('hardness') as HardnessService

    service.register(descriptor('2026.8.2'))
    expect(() => service.register(descriptor('2026.8.2', 'changed projection')))
      .toThrow('capability descriptor openclaw:resume-revision version 2026.8.2 is not newer than 2026.8.2; changed fields: description')

    await ctx.fiber.dispose()
  })
})
