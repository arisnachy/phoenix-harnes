import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import HardnessRegistry from '../src/index.ts'
import type { CapabilityDescriptor, CapabilityEvidence, CapabilityId, HardnessService } from '../src/types.ts'

const id = 'tool:verified-fixture' as CapabilityId
const descriptor: CapabilityDescriptor = {
  id,
  kind: 'tool',
  name: 'Verified fixture',
  description: 'A deterministic verification fixture.',
  inputs: ['fixture_input'],
  outputs: ['fixture_output'],
  dependencies: [],
  requiredPermissions: [],
  provider: 'fixture',
  location: 'local',
  version: '1.0.0',
  compatibility: [],
  limitations: [],
  modalities: ['native'],
  status: 'testing',
}

function evidence(outcome: CapabilityEvidence['outcome'], version = '1.0.0'): CapabilityEvidence {
  return {
    id: `evidence:${outcome}:${version}`,
    capabilityId: id,
    descriptorVersion: version,
    caseId: 'case-1',
    inputSummary: 'fixture input',
    outcome,
    durationMs: 4,
    artifactRefs: ['artifact:fixture-output'],
  }
}

describe('HARDNESS evidence lifecycle', () => {
  it('promotes only the current descriptor after passed evidence', async () => {
    const ctx = new Context()
    await ctx.plugin(HardnessRegistry)
    const service = ctx.get('hardness') as HardnessService | undefined
    if (service === undefined) throw new Error('hardness service missing')
    service.register(descriptor)

    const failed = service.recordEvidence(evidence('failed'))
    expect(failed.outcome).toBe('failed')
    expect(() => { service.promoteFromEvidence(failed.id) }).toThrow(/passed|evidence/i)
    expect(service.get(id)?.status).toBe('testing')

    const passed = service.recordEvidence(evidence('passed'))
    service.promoteFromEvidence(passed.id)
    expect(service.get(id)?.status).toBe('verified')
    expect(service.evidenceFor(id)).toHaveLength(2)

    service.register({ ...descriptor, version: '1.1.0', status: 'testing' })
    expect(() => { service.promoteFromEvidence(passed.id) }).toThrow(/stale|version/i)
    await ctx.fiber.dispose()
  })
})
