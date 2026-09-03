import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it } from 'vitest'
import HardnessRegistry from '@phoenix-ai/dsh-hardness/src/index.ts'
import type { CapabilityId, HardnessService } from '@phoenix-ai/dsh-hardness/src/types.ts'
import { AcquisitionRegistry } from '../src/acquisition-registry.ts'

const descriptor = {
  id: 'tool:weather@1.0.0' as CapabilityId, kind: 'weather', name: 'Weather builder', description: 'built', inputs: ['city'], outputs: ['weather'], dependencies: [], requiredPermissions: [], provider: 'fixture-builder', location: 'local', version: '1.0.0', compatibility: [], limitations: [], modalities: ['native'], status: 'experimental',
} as const

const alternateDescriptor = {
  ...descriptor,
  id: 'tool:weather@2.0.0' as CapabilityId,
  provider: 'alternate-builder',
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

  it('transitions an already indexed experimental candidate instead of registering it twice', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    hardness.register(descriptor)
    const registry = new AcquisitionRegistry(hardness)
    registry.register(async need => need.kind === 'weather' ? descriptor : undefined)

    const result = await registry.acquireOrBuild({ kind: 'weather', inputs: ['city'], outputs: ['weather'] })

    expect(result.kind).toBe('built')
    expect(hardness.get(descriptor.id)?.status).toBe('testing')
    expect(hardness.list().filter(item => item.id === descriptor.id)).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('skips quarantined candidates so recovery can acquire a different provider', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    hardness.register({ ...descriptor, status: 'quarantined' })
    const registry = new AcquisitionRegistry(hardness)
    registry.register(async need => need.kind === 'weather' ? descriptor : undefined)
    registry.register(async need => need.kind === 'weather' ? alternateDescriptor : undefined)

    const result = await registry.acquireOrBuild({ kind: 'weather', inputs: ['city'], outputs: ['weather'] })

    expect(result).toMatchObject({ kind: 'built', capability: { id: alternateDescriptor.id } })
    expect(hardness.get(descriptor.id)?.status).toBe('quarantined')
    expect(hardness.get(alternateDescriptor.id)?.status).toBe('testing')
    await ctx.fiber.dispose()
  })

  it('prepares an already indexed tool whose name exactly matches the requested capability kind', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const imageTool = {
      id: 'tool:image_generation' as CapabilityId,
      kind: 'tool',
      name: 'image_generation',
      description: 'Generate an actual image.',
      inputs: [],
      outputs: [],
      dependencies: [],
      requiredPermissions: [],
      provider: 'dsh-tools',
      location: 'tool-registry',
      version: '1.0.0',
      compatibility: [],
      limitations: [],
      modalities: ['native'],
      status: 'experimental',
    } as const
    hardness.register(imageTool)
    const registry = new AcquisitionRegistry(hardness)

    const result = await registry.acquireOrBuild({
      kind: 'image_generation',
      inputs: ['brief visual de Kira'],
      outputs: ['imagen fotorealista'],
      requiredStatus: 'verified',
    })

    expect(result).toMatchObject({ kind: 'built', capability: { id: imageTool.id, status: 'testing' } })
    expect(hardness.get(imageTool.id)?.status).toBe('testing')
    await ctx.fiber.dispose()
  })
})