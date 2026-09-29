import { describe, expect, it } from 'vitest'
import { greetingForHour, heroAttentionDetail, preferredNameForHero } from '../src/client/skeleton/EmptyHero.tsx'

describe('greetingForHour', () => {
  it('uses the morning greeting before noon', () => {
    expect(greetingForHour(0)).toBe('Buenos días')
    expect(greetingForHour(11)).toBe('Buenos días')
  })

  it('uses the afternoon greeting from noon through 18:59', () => {
    expect(greetingForHour(12)).toBe('Buenas tardes')
    expect(greetingForHour(18)).toBe('Buenas tardes')
  })

  it('uses the evening greeting from 19:00 onward', () => {
    expect(greetingForHour(19)).toBe('Buenas noches')
    expect(greetingForHour(23)).toBe('Buenas noches')
  })
})


describe('preferredNameForHero', () => {
  it('uses the live profile name and trims presentation whitespace', () => {
    expect(preferredNameForHero('  Arisnachy  ')).toBe('Arisnachy')
    expect(preferredNameForHero('Ada')).toBe('Ada')
  })

  it('omits the name when the profile has none', () => {
    expect(preferredNameForHero(undefined)).toBeUndefined()
    expect(preferredNameForHero('   ')).toBeUndefined()
  })
})

describe('heroAttentionDetail', () => {
  it('prefers task-specific copy and keeps generic states concise', () => {
    const base = { id: 'a', taskId: 't', title: 'Task', at: '2026-09-29T16:00:00.000Z', score: 1 } as const
    expect(heroAttentionDetail({ ...base, kind: 'result', detail: '  Material change  ' })).toBe('Material change')
    expect(heroAttentionDetail({ ...base, kind: 'failure' })).toBe('Necesita revisión.')
    expect(heroAttentionDetail({ ...base, kind: 'upcoming' })).toBe('Phoenix lo está preparando.')
    expect(heroAttentionDetail({ ...base, kind: 'result' })).toBe('Hay un resultado nuevo.')
  })
})
