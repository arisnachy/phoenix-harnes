import { describe, expect, it } from 'vitest'
import type { SessionId, SessionSummary } from '@phoenix-ai/dsh-client-runtime/client'
import { KIRA_ROSTER, rosterCardsOf } from '../src/client/KiraTeamsDock.tsx'
import {
  ModelActivityAvatar,
  portraitSrcForKind,
} from '../src/client/ModelActivityAvatar.tsx'

const sid = (id: string) => id as SessionId

function summary(partial: Partial<SessionSummary> & { id: SessionId }): SessionSummary {
  return {
    displayTitle: partial.id,
    running: false,
    updatedAt: 0,
    ...partial,
  } as SessionSummary
}

describe('approved KIRA reference board', () => {
  it('exposes the exact 20-persona roster in the approved visual order', () => {
    expect(KIRA_ROSTER.map(agent => agent.name)).toEqual([
      'Vórtice', 'Aurora', 'Atlas', 'Nova', 'Lumen',
      'Helix', 'Prisma', 'Orión', 'Vega', 'Eclipse',
      'Argo', 'Solaria', 'Nexo', 'Astra', 'Lyra',
      'Zenith', 'Cobalto', 'Quasar', 'Senda', 'Órbita',
    ])
    expect(new Set(KIRA_ROSTER.map(agent => agent.kind)).size).toBe(20)
    expect(KIRA_ROSTER.every(agent => agent.tagline.length > 0)).toBe(true)
  })

  it('keeps all 20 personas visible while live subagents occupy their stable slots', () => {
    const active = summary({
      id: sid('c1'),
      parentId: sid('root'),
      origin: 'subagent',
      running: true,
      projectionValues: {
        subagentActivity: { model: 'gpt-5.6-luna', phase: 'running-tools' },
      },
    })
    const cards = rosterCardsOf([{ summary: active, depth: 1 }])

    expect(cards).toHaveLength(20)
    expect(cards.filter(card => card.summary !== undefined)).toHaveLength(1)
    expect(cards.find(card => card.name === 'Vega')?.summary?.id).toBe(sid('c1'))
    expect(cards.find(card => card.name === 'Vórtice')?.summary).toBeUndefined()
  })
})

describe('approved KIRA portrait assets', () => {
  it('uses one real asset per persona instead of a shared sprite or vector fallback', () => {
    expect(portraitSrcForKind('vortice')).toBe('/assets/kira-agents/vortice.webp')
    expect(portraitSrcForKind('argo')).toBe('/assets/kira-agents/argo.webp')
    expect(portraitSrcForKind('orbita')).toBe('/assets/kira-agents/orbita.webp')
  })

  it('renders ready personas vividly and keeps live phase data for animation', () => {
    const ready = ModelActivityAvatar({
      kind: 'argo',
      activity: undefined,
      running: false,
      pending: false,
      ready: true,
    })
    const live = ModelActivityAvatar({
      kind: 'atlas',
      activity: { model: 'gpt-5.6-luna', phase: 'running-tools' },
      running: true,
      pending: false,
    })
    const readyChildren = Array.isArray(ready.props.children) ? ready.props.children : [ready.props.children]
    const portrait = readyChildren.find((child: { props?: Record<string, unknown> }) =>
      child?.props?.['data-agent-portrait-image'] === true)

    expect(ready.props).toMatchObject({
      'data-avatar': 'argo',
      'data-phase': 'idle',
      'data-state': 'ready',
    })
    expect(portrait?.type).toBe('img')
    expect(portrait?.props?.src).toBe('/assets/kira-agents/argo.webp')
    expect(live.props).toMatchObject({
      'data-avatar': 'atlas',
      'data-phase': 'running-tools',
      'data-state': 'running',
    })
  })
})
