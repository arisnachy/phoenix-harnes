import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEAM_DESIGN,
  DEFAULT_TEAM_DESIGN_DOCUMENT,
  TEAM_DESIGN_MEMBER_IDS,
  activeTeamDesign,
  normalizeTeamDesign,
  normalizeTeamDesignDocument,
  parseTeamDesignDocument,
} from '../src/design-types.ts'

describe('Team Studio design document', () => {
  it('ships one complete stable twenty-specialist roster plus the lead', () => {
    expect(DEFAULT_TEAM_DESIGN.members).toHaveLength(20)
    expect(DEFAULT_TEAM_DESIGN.members.map(member => member.id)).toEqual(TEAM_DESIGN_MEMBER_IDS)
    expect(new Set(DEFAULT_TEAM_DESIGN.members.map(member => member.id)).size).toBe(20)
    expect(DEFAULT_TEAM_DESIGN.lead.id).toBe('lead')
    expect(DEFAULT_TEAM_DESIGN.lead.displayName).toBe('Kira')
  })

  it('lets every visible identity field change while stable runtime ids remain fixed', () => {
    const raw = {
      ...DEFAULT_TEAM_DESIGN,
      id: 'x-lab',
      name: 'X Lab',
      motion: 'expressive',
      lead: {
        ...DEFAULT_TEAM_DESIGN.lead,
        displayName: 'Athena',
        gender: 'female',
        role: 'Directora',
        personality: 'Firme, estratégica y cálida.',
        voice: 'Profunda y serena.',
        avatar: 'vega',
        enabled: false,
      },
      members: DEFAULT_TEAM_DESIGN.members.map((member, index) => ({
        ...member,
        id: member.id,
        displayName: `Persona ${index + 1}`,
        role: `Rol ${index + 1}`,
        gender: index % 2 === 0 ? 'female' : 'male',
        personality: `Personalidad ${index + 1}`,
        voice: `Voz ${index + 1}`,
        avatar: TEAM_DESIGN_MEMBER_IDS[(index + 1) % TEAM_DESIGN_MEMBER_IDS.length],
      })),
    }
    const normalized = normalizeTeamDesign(raw)
    expect(normalized.id).toBe('x-lab')
    expect(normalized.name).toBe('X Lab')
    expect(normalized.lead).toMatchObject({
      id: 'lead',
      displayName: 'Athena',
      role: 'Directora',
      avatar: 'vega',
      enabled: true,
    })
    expect(normalized.members).toHaveLength(20)
    expect(normalized.members.map(member => member.id)).toEqual(TEAM_DESIGN_MEMBER_IDS)
    expect(normalized.members[0]).toMatchObject({
      id: 'vortice',
      displayName: 'Persona 1',
      avatar: 'aurora',
    })
  })

  it('repairs malformed, partial, duplicate, and oversized documents deterministically', () => {
    const malformed = parseTeamDesignDocument('{')
    expect(malformed).toEqual(DEFAULT_TEAM_DESIGN_DOCUMENT)

    const partial = normalizeTeamDesign({
      id: 'My Team !!!',
      name: 'Mi equipo',
      members: [
        { id: 'atlas', displayName: 'Constructor', enabled: false },
        { id: 'atlas', displayName: 'Duplicado' },
        { id: 'not-a-runtime-id', displayName: 'Ignorar' },
      ],
    })
    expect(partial.id).toBe('my-team')
    expect(partial.members).toHaveLength(20)
    expect(partial.members.find(member => member.id === 'atlas')).toMatchObject({
      displayName: 'Constructor',
      enabled: false,
    })
    expect(partial.members.map(member => String(member.id))).not.toContain('not-a-runtime-id')

    const many = normalizeTeamDesignDocument({
      version: 1,
      activeTeamId: 'missing',
      teams: Array.from({ length: 20 }, (_, index) => ({
        ...DEFAULT_TEAM_DESIGN,
        id: index < 2 ? 'same' : `team-${index}`,
        name: `Team ${index}`,
      })),
    })
    expect(many.teams).toHaveLength(12)
    expect(new Set(many.teams.map(team => team.id)).size).toBe(12)
    expect(many.activeTeamId).toBe(many.teams[0]?.id)
    expect(activeTeamDesign(many).id).toBe(many.activeTeamId)
  })
})
