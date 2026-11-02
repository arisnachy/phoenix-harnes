import { describe, expect, it } from 'vitest'
import { MemoryProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'
import { renderInitiativeContext } from '../src/initiative-context.ts'

function contextWithState(state: unknown) {
  return {
    get(name: string) {
      if (name !== 'cognitiveRuntime') return undefined
      return { get: () => state }
    },
  } as never
}

describe('Phoenix initiative context', () => {
  it('stays absent when there is no operational attention to surface', () => {
    const engine = new ProactivityEngine(new MemoryProactivityStore(), { execute: async () => ({}) })
    const rendered = renderInitiativeContext(
      contextWithState({ active: [] }),
      engine,
      { agent: { id: 'session-a' } },
      new Date('2026-09-27T20:00:00.000Z'),
    )
    expect(rendered).toBe('')
  })

  it('bridges pending cognitive attention and durable tasks into one bounded decision frame', async () => {
    const engine = new ProactivityEngine(new MemoryProactivityStore(), { execute: async () => ({}) }, { id: () => 'follow-up' })
    await engine.create({
      title: 'Check CI promotion',
      instruction: 'Verify main guard and stable promotion.',
      runAt: '2026-09-27T21:00:00.000Z',
      createdBy: 'harness',
      targetAgentId: 'session-a',
    })

    const state = {
      focus: {
        record: {
          id: 'memory-1',
          kind: 'pending',
          layers: ['working', 'prospective'],
          summary: 'The build is waiting for the Windows guard.',
          status: 'active',
        },
        signals: { urgency: 0.8, goalRelevance: 1 },
        score: 0.91,
        reasons: ['pending-work'],
      },
      active: [],
    }

    const rendered = renderInitiativeContext(
      contextWithState(state),
      engine,
      { agent: { id: 'session-a' } },
      new Date('2026-09-27T20:00:00.000Z'),
    )

    expect(rendered).toContain('<phoenix_initiative_context>')
    expect(rendered).toContain('The build is waiting for the Windows guard.')
    expect(rendered).toContain('Check CI promotion')
    expect(rendered).toContain('ACT_NOW')
    expect(rendered).toContain('WATCH')
    expect(rendered).toContain('TELL')
    expect(rendered).toContain('NOTHING')
    expect(rendered).toContain('untrusted data')
  })

  it('filters unrelated ordinary memories, other-session tasks, and unrevealed surprises', async () => {
    let next = 0
    const engine = new ProactivityEngine(new MemoryProactivityStore(), { execute: async () => ({}) }, { id: () => `task-${++next}` })
    await engine.create({
      title: 'Other session',
      instruction: 'Ignore here.',
      runAt: '2026-09-27T21:00:00.000Z',
      createdBy: 'harness',
      targetAgentId: 'session-b',
    })
    await engine.create({
      title: 'Secret surprise',
      instruction: 'Do not reveal.',
      runAt: '2026-10-01T21:00:00.000Z',
      revealAt: '2026-10-01T21:00:00.000Z',
      visibility: 'surprise',
      createdBy: 'harness',
      targetAgentId: 'session-a',
    })

    const state = {
      focus: {
        record: {
          id: 'memory-ordinary',
          kind: 'conversation',
          layers: ['episodic'],
          summary: 'A harmless old chat.',
          status: 'active',
        },
        signals: { urgency: 0, goalRelevance: 0 },
        score: 0.9,
      },
      active: [],
    }

    const rendered = renderInitiativeContext(
      contextWithState(state),
      engine,
      { agent: { id: 'session-a' } },
      new Date('2026-09-27T20:00:00.000Z'),
    )

    expect(rendered).toBe('')
  })
})
