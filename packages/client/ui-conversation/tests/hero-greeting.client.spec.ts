import { describe, expect, it } from 'vitest'
import { academicCoverPrompt } from '../src/client/skeleton/AcademicCoverEditor.tsx'
import {
  greetingForHour, heroAttentionDetail, heroAttentionPrompt, preferredNameForHero, researchStarterPrompt,
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

describe('heroAttentionDetail', () => {
  it('prefers task-specific copy and keeps generic states useful', () => {
    const base = { id: 'a', revision: 'r1', taskId: 't', title: 'Task', at: '2026-09-29T16:00:00.000Z', score: 1 } as const
    expect(heroAttentionDetail({ ...base, kind: 'result', detail: '  Material change  ' })).toBe('Material change')
    expect(heroAttentionDetail({ ...base, kind: 'failure' })).toBe('Phoenix no pudo completar esta tarea.')
    expect(heroAttentionDetail({ ...base, kind: 'upcoming' })).toBe('Se acerca esta tarea.')
    expect(heroAttentionDetail({ ...base, kind: 'result' })).toBe('Hay un resultado nuevo.')
  })

  it('turns a clicked signal into an actionable Phoenix draft', () => {
    const base = { id: 'a', revision: 'r1', taskId: 't', title: 'PHOENIX main guard', at: '2026-09-29T16:00:00.000Z', score: 1 } as const
    expect(heroAttentionPrompt({
      ...base,
      kind: 'failure',
      detail: 'Falló en CI; localiza el bloqueo actual.',
    })).toContain('Encuentra la causa y ayúdame a resolverlo.')
    expect(heroAttentionPrompt({
      ...base,
      kind: 'result',
      detail: 'Hay un resultado nuevo.',
    })).toContain('qué requiere mi atención')
  })
})

describe('research academic hero starter prompts', () => {
  it('distinguishes citation styles from scientific article type and keeps the draft editable', () => {
    expect(researchStarterPrompt('apa7')).toContain('APA 7')
    expect(researchStarterPrompt('vancouver')).toContain('Vancouver')
    expect(researchStarterPrompt('scientific_article')).toContain('artículo científico')
    expect(researchStarterPrompt('scientific_article')).toContain('DOCX, PDF')
    expect(researchStarterPrompt('apa7')).toContain('solo los datos académicos que falten')
  })
})

describe('academic cover preview is not a file upload', () => {
  it('preserves author IDs and explains that logo preview still requires a chat upload', () => {
    const text = academicCoverPrompt({
      citation: 'apa7', title: 'Neuropsicología clínica', institution: 'Universidad de prueba',
      faculty: 'Medicina', degree: 'Maestría', course: 'Investigación',
      advisor: 'Docente de prueba', authors: 'Ana Pérez | 2026-001\nLuis Díaz | 2026-002',
      city: 'Santiago, RD', logoName: 'logo.png',
    })
    expect(text).toContain('Ana Pérez | 2026-001')
    expect(text).toContain('Luis Díaz | 2026-002')
    expect(text).toContain('SOLO para previsualización')
    expect(text).toContain('adjun')
    expect(text).toContain('phoenix_research_plan')
  })
})
