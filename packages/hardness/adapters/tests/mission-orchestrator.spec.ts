import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import HardnessRegistry from '@deepseek-ai/dsh-hardness/src/index.ts'
import type { CapabilityId, HardnessService } from '@deepseek-ai/dsh-hardness/src/types.ts'
import { AcquisitionRegistry } from '../src/acquisition-registry.ts'
import { ArtifactRuntime } from '../src/artifact-runtime.ts'
import { runHardnessMission } from '../src/mission-orchestrator.ts'
import { LabMode, SelfImprovementLedger } from '../src/lab-mode.ts'

const descriptor = { id: 'tool:weather' as CapabilityId, kind: 'weather', name: 'Weather', description: 'fixture', inputs: ['city'], outputs: ['forecast'], dependencies: [], requiredPermissions: [], provider: 'fixture', location: 'tool-registry', version: '1', compatibility: [], limitations: [], modalities: ['native'], status: 'experimental' } as const

describe('HARDNESS mission orchestrator', () => {
  it('promotes a prepared capability only after successful execution and artifact verification', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const lab = new LabMode('mission')
    const ledger = new SelfImprovementLedger()
    const acquisition = new AcquisitionRegistry(hardness, { lab, ledger })
    acquisition.register(async need => need.kind === 'weather' ? descriptor : undefined)
    const tools = { execute: vi.fn(async () => ({ isError: false as const, value: null, content: [], meta: { artifact: { id: 'forecast', mime: 'text/plain', data: 'sunny' } } })) }
    const approval = { request: vi.fn(async () => ({ kind: 'approved' as const, grants: [] })) }
    const artifacts = new ArtifactRuntime()
    artifacts.register('text/plain', artifact => ({ kind: 'text', artifactId: artifact.id }))

    const result = await runHardnessMission({ hardness, acquisition, tools, approval, artifacts, need: { kind: 'weather', inputs: ['city'], outputs: ['forecast'] }, args: { city: 'Madrid' }, context: { callId: 'mission-1' as never, signal: new AbortController().signal } })

    expect(result).toMatchObject({ kind: 'completed', artifact: { id: 'forecast' }, rendered: { kind: 'text' } })
    expect(tools.execute).toHaveBeenCalledTimes(1)
    expect(hardness.get(descriptor.id)?.status).toBe('verified')
    expect(hardness.evidenceFor(descriptor.id)).toHaveLength(1)
    expect(hardness.evidenceFor(descriptor.id)[0]).toMatchObject({ outcome: 'passed', artifactRefs: ['forecast'] })
    expect(lab.snapshot().experiments).toHaveLength(1)
    expect(ledger.snapshot()).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('quarantines a testing capability when real execution reports an error', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const acquisition = new AcquisitionRegistry(hardness)
    acquisition.register(async need => need.kind === 'weather' ? descriptor : undefined)
    const tools = { execute: vi.fn(async () => ({ isError: true as const, error: { message: 'provider failed' }, content: [{ type: 'text' as const, text: 'provider failed' }] })) }
    const approval = { request: vi.fn(async () => ({ kind: 'approved' as const, grants: [] })) }
    const artifacts = new ArtifactRuntime()
    artifacts.register('text/plain', artifact => ({ kind: 'text', artifactId: artifact.id }))

    const result = await runHardnessMission({ hardness, acquisition, tools, approval, artifacts, need: { kind: 'weather', inputs: ['city'], outputs: ['forecast'] }, args: { city: 'Madrid' }, context: { callId: 'mission-fail' as never, signal: new AbortController().signal } })

    expect(result).toMatchObject({ kind: 'blocked' })
    expect(hardness.get(descriptor.id)?.status).toBe('quarantined')
    expect(hardness.evidenceFor(descriptor.id)).toHaveLength(1)
    expect(hardness.evidenceFor(descriptor.id)[0]).toMatchObject({ outcome: 'failed' })
    await ctx.fiber.dispose()
  })
})
