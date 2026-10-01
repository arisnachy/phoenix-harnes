import { describe, expect, it } from 'vitest'
import {
  greetingForHour, heroAttentionDetail, heroAttentionPrompt, heroAttentionSource, preferredNameForHero,
} from '../src/client/skeleton/EmptyHero.tsx'

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

describe('hero proactive attention', () => {
  const base = { id: 'a', taskId: 't', title: 'Task', at: '2026-09-29T16:00:00.000Z', score: 1 } as const

  it('shows task-specific detail only and never invents generic filler', () => {
    expect(heroAttentionDetail({ ...base, kind: 'result', detail: '  Material change  ' })).toBe('Material change')
    expect(heroAttentionDetail({ ...base, kind: 'failure' })).toBeUndefined()
    expect(heroAttentionDetail({ ...base, kind: 'upcoming' })).toBeUndefined()
    expect(heroAttentionDetail({ ...base, kind: 'result' })).toBeUndefined()
  })

  it('infers compact source hints and turns a click into an actionable draft', () => {
    const github = {
      ...base,
      kind: 'failure' as const,
      title: 'PHOENIX main guard',
      detail: 'Falló en CI; localiza el bloqueo actual.',
    }
    expect(heroAttentionSource(github)).toBe('GH')
    expect(heroAttentionSource({ ...base, kind: 'result', title: 'Inbox review' })).toBe('M')
    expect(heroAttentionSource({ ...base, kind: 'upcoming', title: 'Agenda de hoy' })).toBe('CAL')
    expect(heroAttentionPrompt(github)).toContain('localiza el bloqueo actual y corrígelo')
    expect(heroAttentionPrompt(github)).toContain('Falló en CI')
  })
})
