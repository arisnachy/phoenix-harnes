import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import HardnessRegistry from '@deepseek-ai/dsh-hardness/src/index.ts'
import type { CapabilityId, HardnessService } from '@deepseek-ai/dsh-hardness/src/types.ts'
import { AcquisitionRegistry } from '../src/acquisition-registry.ts'

const descriptor = {
  id: 'tool:weather@1.0.0' as CapabilityId, kind: 'weather', name: 'Weather builder', description: 'built', inputs: ['city'], outputs: ['weather'], dependencies: [], requiredPermissions: [], provider: 'fixture-builder', location: 'local', version: '1.0.0', compatibility: [], limitations: [], modalities: ['native'], status: 'experimental',
} as const

describe('HARDNESS acquisition/build registry', () => {
  it('prepares an unknown need as testing without fabricating passed execution evidence', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const registry = new AcquisitionRegistry(hardness)
    registry.register(async need => need.kind === 'weather' ? descriptor : undefined)

    const result = await registry.acquireOrBuild({ kind: 'weather', inputs: ['city'], outputs: ['weather'] })

    expect(result.kind).toBe('built')
    if (result.kind !== 'built') return
    expect(hardness.get(descriptor.id)?.status).toBe('testing')
    expect(hardness.evidenceFor(descriptor.id)).toHaveLength(0)
    expect(hardness.resolveNeed({ kind: 'weather', inputs: ['city'], outputs: ['weather'] }).kind).toBe('have')
    expect(hardness.resolveNeed({ kind: 'weather', inputs: ['city'], outputs: ['weather'], requiredStatus: 'verified' }).kind).toBe('missing')
    await ctx.fiber.dispose()
  })
})
