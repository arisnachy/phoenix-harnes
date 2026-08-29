import { describe, expect, it } from 'vitest'
import type { CapabilityDescriptor, CapabilityId } from '@deepseek-ai/dsh-hardness'
import { searchCapabilityAtlas } from '../src/capability-search.ts'

function capability(overrides: Partial<CapabilityDescriptor> & Pick<CapabilityDescriptor, 'id' | 'kind' | 'name'>): CapabilityDescriptor {
  return {
    id: overrides.id,
    kind: overrides.kind,
    name: overrides.name,
    description: overrides.description ?? overrides.name,
    inputs: overrides.inputs ?? [],
    outputs: overrides.outputs ?? [],
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

describe('HARDNESS capability search', () => {
  it('finds semantic names and descriptions without dumping the full atlas', () => {
    const descriptors = [
      capability({ id: 'skill:calendar-planning' as CapabilityId, kind: 'calendar-planning', name: 'calendar-planning', description: 'Plans meetings and calendar work.' }),
      capability({ id: 'tool:read_calendar' as CapabilityId, kind: 'read_calendar', name: 'read_calendar', description: 'Reads calendar events.', status: 'verified' }),
      capability({ id: 'openclaw:brave' as CapabilityId, kind: 'web-search', name: 'OpenClaw · brave', description: 'Searches the public web.', status: 'testing' }),
    ]

    const matches = searchCapabilityAtlas(descriptors, 'calendar', 2)

    expect(matches).toHaveLength(2)
    expect(matches.map(match => match.id)).toEqual(expect.arrayContaining(['tool:read_calendar', 'skill:calendar-planning']))
    expect(matches.every(match => match.executable === (match.status === 'verified' || match.status === 'testing'))).toBe(true)
    expect(searchCapabilityAtlas(descriptors, 'quantum-teleporter', 6)).toEqual([])
  })

  it('ranks an exact capability family above prose-only overlap and exposes pending permissions', () => {
    const descriptors = [
      capability({ id: 'openclaw:brave' as CapabilityId, kind: 'web-search', name: 'OpenClaw · brave', requiredPermissions: [{ kind: 'network.access' }], status: 'testing' }),
      capability({ id: 'skill:research' as CapabilityId, kind: 'research', name: 'research', description: 'Research with web search when useful.' }),
    ]

    const [match] = searchCapabilityAtlas(descriptors, 'web search', 6)

    expect(match?.id).toBe('openclaw:brave')
    expect(match?.requiredPermissions).toEqual(['network.access'])
  })

  it('is bounded, deterministic, and keeps quarantined matches visible but non-executable', () => {
    const descriptors = Array.from({ length: 20 }, (_, index) => capability({
      id: `tool:search-${String(index).padStart(2, '0')}` as CapabilityId,
      kind: `search-${index}`,
      name: `search-${index}`,
      description: 'search utility',
      status: index === 0 ? 'quarantined' : 'experimental',
    }))

    const first = searchCapabilityAtlas(descriptors, 'search', 6)
    const second = searchCapabilityAtlas([...descriptors].reverse(), 'search', 6)

    expect(first).toHaveLength(6)
    expect(second).toEqual(first)
    const quarantined = searchCapabilityAtlas(descriptors, 'search-0', 6).find(match => match.id === 'tool:search-00')
    expect(quarantined).toMatchObject({ executable: false, status: 'quarantined' })
  })
})