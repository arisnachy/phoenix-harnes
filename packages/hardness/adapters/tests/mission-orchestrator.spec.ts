import { Context } from '@phoenix-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import HardnessRegistry from '@phoenix-ai/dsh-hardness/src/index.ts'
import type { CapabilityId, HardnessService } from '@phoenix-ai/dsh-hardness/src/types.ts'
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
    const audit = { record: vi.fn() }
    const judge = vi.fn(async () => ({
      verdict: 'pass' as const,
      summary: 'artifact satisfies the mission objective',
      evidence: ['forecast'],
      requiredChanges: [],
      criteria: [
        { id: 'artifact-produced', verdict: 'pass' as const, evidence: ['forecast'], findings: [] },
        { id: 'artifact-rendered', verdict: 'pass' as const, evidence: ['forecast'], findings: [] },
      ],
      quality: { verdict: 'pass' as const, summary: 'complete and reproducible', evidence: ['forecast'], findings: [] },
    }))

    const result = await runHardnessMission({ hardness, acquisition, tools, approval, artifacts, audit, judge, need: { kind: 'weather', inputs: ['city'], outputs: ['forecast'] }, args: { city: 'Madrid' }, context: { callId: 'mission-1' as never, signal: new AbortController().signal } })

    expect(result).toMatchObject({ kind: 'completed', artifact: { id: 'forecast' }, rendered: { kind: 'text' } })
    expect(tools.execute).toHaveBeenCalledTimes(1)
    expect(judge).toHaveBeenCalledWith(expect.objectContaining({ artifactId: 'forecast', evidenceId: expect.any(String) }))
    expect(hardness.get(descriptor.id)?.status).toBe('verified')
    expect(hardness.evidenceFor(descriptor.id)).toHaveLength(1)
    expect(hardness.evidenceFor(descriptor.id)[0]).toMatchObject({ outcome: 'passed', artifactRefs: ['forecast'] })
    expect(audit.record.mock.calls.map(([entry]) => [entry.step, entry.outcome])).toEqual([
      ['inspect', 'completed'],
      ['resolve', 'completed'],
      ['plan', 'completed'],
      ['approve', 'completed'],
      ['execute', 'completed'],
      ['verify', 'completed'],
      ['present', 'completed'],
      ['audit', 'completed'],
    ])
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
    const audit = { record: vi.fn() }

    const result = await runHardnessMission({ hardness, acquisition, tools, approval, artifacts, audit, need: { kind: 'weather', inputs: ['city'], outputs: ['forecast'] }, args: { city: 'Madrid' }, context: { callId: 'mission-fail' as never, signal: new AbortController().signal } })

    expect(result).toMatchObject({ kind: 'blocked' })
    expect(hardness.get(descriptor.id)?.status).toBe('quarantined')
    expect(hardness.evidenceFor(descriptor.id)).toHaveLength(1)
    expect(hardness.evidenceFor(descriptor.id)[0]).toMatchObject({ outcome: 'failed' })
    expect(audit.record.mock.calls.map(([entry]) => [entry.step, entry.outcome])).toEqual([
      ['inspect', 'completed'],
      ['resolve', 'completed'],
      ['plan', 'completed'],
      ['approve', 'completed'],
      ['execute', 'completed'],
      ['execute', 'blocked'],
      ['audit', 'completed'],
      ['inspect', 'completed'],
      ['resolve', 'blocked'],
      ['audit', 'completed'],
    ])
    await ctx.fiber.dispose()
  })

  it('keeps a mission active when the independent judge requires changes', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const acquisition = new AcquisitionRegistry(hardness)
    acquisition.register(async need => need.kind === 'weather' ? descriptor : undefined)
    const tools = { execute: vi.fn(async () => ({ isError: false as const, value: null, content: [], meta: { artifact: { id: 'forecast', mime: 'text/plain', data: 'sunny' } } })) }
    const approval = { request: vi.fn(async () => ({ kind: 'approved' as const, grants: [] })) }
    const artifacts = new ArtifactRuntime()
    artifacts.register('text/plain', artifact => ({ kind: 'text', artifactId: artifact.id }))
    const session = { events: [], append: vi.fn() }
    const judge = vi.fn(async () => ({
      verdict: 'needs_changes' as const,
      summary: 'the result needs an independently reproducible check',
      evidence: ['forecast'],
      requiredChanges: ['add a reproducible verification'],
      criteria: [],
      quality: { verdict: 'fail' as const, summary: 'reproducibility is missing', evidence: [], findings: ['add a reproducible verification'] },
    }))

    const result = await runHardnessMission({
      hardness, acquisition, tools, approval, artifacts, judge,
      need: { kind: 'weather', inputs: ['city'], outputs: ['forecast'] },
      args: { city: 'Madrid' },
      context: { callId: 'mission-judge-changes' as never, signal: new AbortController().signal, agent: { session } as never },
    })

    expect(result).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('add a reproducible verification') })
    expect(judge).toHaveBeenCalledOnce()
    expect(hardness.get(descriptor.id)?.status).not.toBe('verified')
    expect(session.append).toHaveBeenCalledWith('hardness/kernel', expect.objectContaining({ kind: 'judge', status: 'ACTIVE' }))
    await ctx.fiber.dispose()
  })

  it('automatically retries a disposable tool failure through an alternate ATLAS provider', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const alternate = { ...descriptor, id: 'tool:weather-alt' as CapabilityId, provider: 'alternate', version: '2' as const }
    const acquisition = new AcquisitionRegistry(hardness)
    acquisition.register(async need => need.kind === 'weather' ? descriptor : undefined)
    acquisition.register(async need => need.kind === 'weather' ? alternate : undefined)
    const tools = { execute: vi.fn()
      .mockResolvedValueOnce({ isError: true as const, error: { message: 'provider failed' }, content: [] })
      .mockResolvedValueOnce({ isError: false as const, value: null, content: [], meta: { artifact: { id: 'forecast', mime: 'text/plain', data: 'sunny' } } }) }
    const approval = { request: vi.fn(async () => ({ kind: 'approved' as const, grants: [] })) }
    const artifacts = new ArtifactRuntime()
    artifacts.register('text/plain', artifact => ({ kind: 'text', artifactId: artifact.id }))
    const judge = vi.fn(async () => ({
      verdict: 'pass' as const,
      summary: 'alternate provider delivered a verified result',
      evidence: ['forecast'],
      requiredChanges: [],
      criteria: [
        { id: 'artifact-produced', verdict: 'pass' as const, evidence: ['forecast'], findings: [] },
        { id: 'artifact-rendered', verdict: 'pass' as const, evidence: ['forecast'], findings: [] },
      ],
      quality: { verdict: 'pass' as const, summary: 'complete', evidence: ['forecast'], findings: [] },
    }))

    const result = await runHardnessMission({
      hardness, acquisition, tools, approval, artifacts, judge,
      need: { kind: 'weather', inputs: ['city'], outputs: ['forecast'] }, args: { city: 'Madrid' },
      context: { callId: 'mission-recovery' as never, signal: new AbortController().signal },
    })

    expect(result).toMatchObject({ kind: 'completed', artifact: { id: 'forecast' } })
    expect(tools.execute).toHaveBeenCalledTimes(2)
    expect(hardness.get(descriptor.id)?.status).toBe('quarantined')
    expect(hardness.get(alternate.id)?.status).toBe('verified')
    expect(judge).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('does not close or promote a mission when no judge is available', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const hardness = ctx.get('hardness') as HardnessService
    const acquisition = new AcquisitionRegistry(hardness)
    acquisition.register(async need => need.kind === 'weather' ? descriptor : undefined)
    const approval = { request: vi.fn(async () => ({ kind: 'approved' as const, grants: [] })) }
    const artifacts = new ArtifactRuntime()
    artifacts.register('text/plain', artifact => ({ kind: 'text', artifactId: artifact.id }))

    const result = await runHardnessMission({
      hardness, acquisition,
      tools: { execute: vi.fn(async () => ({ isError: false as const, value: null, content: [], meta: { artifact: { id: 'forecast', mime: 'text/plain', data: 'sunny' } } })) },
      approval, artifacts,
      need: { kind: 'weather' }, args: {},
      context: { callId: 'mission-no-judge' as never, signal: new AbortController().signal },
    })

    expect(result).toMatchObject({ kind: 'blocked', reason: expect.stringContaining('independent judge') })
    expect(hardness.get(descriptor.id)?.status).not.toBe('verified')
    await ctx.fiber.dispose()
  })
})
