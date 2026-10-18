import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { academicCoverPrompt } from '../src/client/skeleton/AcademicCoverEditor.tsx'
import {
  greetingForHour, heroAttentionDetail, heroAttentionPrompt, preferredNameForHero,
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

describe('universal Phoenix start', () => {
  it('preserves the open-ended greeting and proactive, task-specific responses', () => {
    expect(greetingForHour(13)).toBe('Buenas tardes')
    expect(heroAttentionDetail({
      id: 'event', revision: 'r', taskId: 'task', title: 'Cualquier misión',
      at: '2026-10-18T00:00:00.000Z', score: 2, kind: 'result',
      detail: 'El resultado de esta misión está listo.',
    })).toContain('resultado')
  })
})

describe('neutral, universal hero architecture', () => {
  it('does not embed permanent domain buttons or domain-specific callbacks', () => {
    const source = readFileSync(new URL('../src/client/skeleton/EmptyHero.tsx', import.meta.url), 'utf8')
    expect(source).toContain('¿En qué podemos trabajar hoy?')
    expect(source).not.toContain('onResearchSelect')
    expect(source).not.toContain('onGameSelect')
    expect(source).not.toContain('Investigación APA 7')
    expect(source).not.toContain('Investigación Vancouver')
    expect(source).not.toContain('Artículo científico')
    expect(source).not.toContain('Personalizar portada')
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
