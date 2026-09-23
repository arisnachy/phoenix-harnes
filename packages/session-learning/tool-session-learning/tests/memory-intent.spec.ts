import { describe, expect, it } from 'vitest'
import { resolveMemoryIntent } from '../src/memory-intent.ts'

const NOW = Date.parse('2026-09-15T13:00:00.000Z')
const OFFSET_MINUTES = -240

describe('memory intent resolution', () => {
  it('routes Spanish yesterday work-history questions to cross-project episodic recall', () => {
    const intent = resolveMemoryIntent('¿Qué hicimos ayer y en qué proyectos trabajamos?', {
      now: NOW,
      timezoneOffsetMinutes: OFFSET_MINUTES,
    })

    expect(intent.kind).toBe('work-history')
    expect(intent.crossProject).toBe(true)
    expect(intent.layers).toContain('episodic')
    expect(intent.layers).toContain('temporal')
    expect(intent.from).toBe(Date.parse('2026-09-14T04:00:00.000Z'))
    expect(intent.to).toBe(Date.parse('2026-09-15T03:59:59.999Z'))
  })

  it('routes learning-history separately from personal profile recall', () => {
    const intent = resolveMemoryIntent('¿Qué aprendiste ayer de los trabajos que hicimos?', {
      now: NOW,
      timezoneOffsetMinutes: OFFSET_MINUTES,
    })

    expect(intent.kind).toBe('learning-history')
    expect(intent.excludeProfileSubjects).toBe(true)
    expect(intent.crossProject).toBe(true)
  })

  it('does not invoke autobiographical history for an ordinary task', () => {
    const intent = resolveMemoryIntent('Arregla este error de TypeScript', {
      now: NOW,
      timezoneOffsetMinutes: OFFSET_MINUTES,
    })

    expect(intent.kind).toBe('ordinary')
    expect(intent.from).toBeUndefined()
    expect(intent.to).toBeUndefined()
    expect(intent.crossProject).toBe(false)
  })

  it('resolves last week to an absolute local calendar window', () => {
    const intent = resolveMemoryIntent('¿Qué proyectos hicimos la semana pasada?', {
      now: NOW,
      timezoneOffsetMinutes: OFFSET_MINUTES,
    })

    expect(intent.kind).toBe('work-history')
    expect(intent.from).toBe(Date.parse('2026-09-07T04:00:00.000Z'))
    expect(intent.to).toBe(Date.parse('2026-09-14T03:59:59.999Z'))
  })
})
