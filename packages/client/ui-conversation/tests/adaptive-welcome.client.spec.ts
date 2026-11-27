import { describe, expect, it } from 'vitest'
import { adaptiveWelcome } from '../src/client/skeleton/adaptive-welcome.ts'
import type { ProactivityAttentionItem } from '../src/client/contract/slots.ts'
import type { Celebration } from '../src/client/skeleton/celebrations.ts'
function signal(kind: ProactivityAttentionItem['kind']): ProactivityAttentionItem {
  return { id: kind, revision: '1', taskId: 'task', kind, title: 'Tarea', at: '2026-11-27T10:00:00Z', score: 1 }
}
const holiday: Celebration = { id: 'birthday', label: 'Cumpleaños', date: '2026-11-27', country: 'DO', theme: 'birthday', tone: 'festive', source: 'personal' }
describe('adaptive welcome', () => {
  it('prioritizes real blockers and failures', () => {
    expect(adaptiveWelcome(10, 0, [signal('result')], holiday, true).pose).toBe('ready')
    expect(adaptiveWelcome(10, 0, [signal('result'), signal('failure')], holiday).pose).toBe('tools')
  })
  it('distinguishes results and future work', () => {
    expect(adaptiveWelcome(10, 0, [signal('result')]).pose).toBe('settled')
    expect(adaptiveWelcome(10, 0, [signal('upcoming')]).pose).toBe('plan')
  })
  it('honors festive and solemn dates', () => {
    expect(adaptiveWelcome(10, 0, [], holiday).pose).toBe('celebrate')
    expect(adaptiveWelcome(10, 0, [signal('result')], { ...holiday, tone: 'solemn' }).pose).toBe('respectful')
  })
  it('varies neutral scenes without claims of completed work', () => {
    expect(new Set([0,1,2,3].map(seed => adaptiveWelcome(10, seed, []).subtitle)).size).toBe(4)
    expect(adaptiveWelcome(23, 2, []).pose).toBe('sleep')
  })
})
