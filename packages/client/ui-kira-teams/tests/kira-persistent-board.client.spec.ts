import { describe, expect, it } from 'vitest'
import type { SessionId, SessionSummary } from '@phoenix-ai/dsh-client-runtime/client'
import { KIRA_ROSTER, liveCardsOf } from '../src/client/KiraTeamsDock.tsx'

const sid = (id: string) => id as SessionId

function summary(partial: Partial<SessionSummary> & { id: SessionId }): SessionSummary {
  return {
    displayTitle: partial.id,
    running: false,
    updatedAt: 0,
    ...partial,
  } as SessionSummary
}

describe('persistent KIRA reference board', () => {
  it('keeps all 20 approved personas visible when only one subagent is live', () => {
    const active = summary({
      id: sid('c1'),
      parentId: sid('root'),
      origin: 'subagent',
      running: true,
      projectionValues: {
        subagentActivity: { model: 'gpt-5.6-luna', phase: 'running-tools' },
      },
    })

    const cards = liveCardsOf([{ summary: active, depth: 1 }])

    expect(KIRA_ROSTER).toHaveLength(20)
    expect(cards).toHaveLength(20)
    expect(cards.filter(card => card.summary !== undefined)).toHaveLength(1)
    expect(cards.find(card => card.summary?.id === sid('c1'))?.kind).toBe('vega')
    expect(cards.filter(card => card.summary === undefined)).toHaveLength(19)
  })

  it('keeps simultaneous live subagents on unique persona slots without hiding idle personas', () => {
    const one = summary({ id: sid('ab'), parentId: sid('root'), origin: 'subagent', running: true })
    const two = summary({ id: sid('ba'), parentId: sid('root'), origin: 'subagent', running: true })

    const cards = liveCardsOf([
      { summary: one, depth: 1 },
      { summary: two, depth: 1 },
    ])
    const live = cards.filter(card => card.summary !== undefined)

    expect(cards).toHaveLength(20)
    expect(live).toHaveLength(2)
    expect(new Set(live.map(card => card.kind)).size).toBe(2)
    expect(live.map(card => card.summary?.id)).toEqual([sid('ab'), sid('ba')])
  })
})
