import { describe, expect, it } from 'vitest'
import type { CapabilityDescriptor, CapabilityId } from '@deepseek-ai/dsh-hardness'
import { buildCapabilityCensus } from '../src/capability-census.ts'

function descriptor(overrides: Partial<CapabilityDescriptor> & Pick<CapabilityDescriptor, 'id' | 'kind' | 'name'>): CapabilityDescriptor {
  return {
    id: overrides.id,
    kind: overrides.kind,
    name: overrides.name,
    description: overrides.description ?? overrides.name,
    inputs: overrides.inputs ?? ['query'],
    outputs: overrides.outputs ?? ['result'],
    dependencies: overrides.dependencies ?? [],
    requiredPermissions: overrides.requiredPermissions ?? [],
    provider: overrides.provider ?? 'fixture',
    location: overrides.location ?? 'local',
    version: overrides.version ?? '1.0.0',
    compatibility: overrides.compatibility ?? [],
    limitations: overrides.limitations ?? [],
    modalities: overrides.modalities ?? ['native'],
    status: overrides.status ?? 'experimental',
  }
}

describe('HARDNESS capability census', () => {
  it('groups exact behavioral duplicates without deleting either descriptor', () => {
    const first = descriptor({ id: 'tool:web-search' as CapabilityId, kind: 'web-search', name: 'web-search', status: 'verified' })
    const second = descriptor({ id: 'openclaw:brave' as CapabilityId, kind: 'web-search', name: 'brave', status: 'testing' })

    const census = buildCapabilityCensus([first, second])

    expect(census.total).toBe(2)
    expect(census.unique).toBe(1)
    expect(census.groups).toHaveLength(1)
    expect(census.groups[0]).toMatchObject({
      classification: 'exact-duplicate',
      canonicalId: first.id,
      memberIds: [first.id, second.id],
    })
    expect([first.status, second.status]).toEqual(['verified', 'testing'])
  })

  it('classifies same-kind contract variants as overlapping and chooses deterministically', () => {
    const broad = descriptor({ id: 'tool:search-all' as CapabilityId, kind: 'web-search', name: 'search-all', inputs: ['query', 'freshness'], status: 'testing' })
    const narrow = descriptor({ id: 'tool:search' as CapabilityId, kind: 'web-search', name: 'search', inputs: ['query'], status: 'testing' })

    const census = buildCapabilityCensus([narrow, broad])

    expect(census.groups[0]).toMatchObject({
      classification: 'overlapping',
      canonicalId: broad.id,
      memberIds: [broad.id, narrow.id],
    })
    expect(census.duplicates).toBe(0)
    expect(census.overlapping).toBe(2)
  })

  it('keeps unrelated capability families as separate unique groups', () => {
    const calendar = descriptor({ id: 'tool:calendar' as CapabilityId, kind: 'calendar', name: 'calendar' })
    const search = descriptor({ id: 'tool:search' as CapabilityId, kind: 'web-search', name: 'search' })

    const census = buildCapabilityCensus([calendar, search])

    expect(census.total).toBe(2)
    expect(census.unique).toBe(2)
    expect(census.groups).toHaveLength(2)
    expect(census.groups.every(group => group.classification === 'unique')).toBe(true)
  })
})