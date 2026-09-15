// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId, SessionListState, SessionSummary } from '@phoenix-ai/dsh-client-runtime/client'
import {
  KIRA_ROSTER,
  KiraTeamsDock,
  activityKeyOf,
  agentRoleKeyOf,
  liveCardsOf,
  performanceKeyOf,
  type KiraTeamsDockProps,
} from '../src/client/KiraTeamsDock.tsx'
import { en, es, zh, type KiraTeamsKey } from '../src/client/locales.ts'
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

function translate(key: KiraTeamsKey, params?: { count?: number }): string {
  const value = es[key]
  return params?.count === undefined ? value : value.replace('{count}', String(params.count))
}

describe('approved KIRA compact live-agent dock', () => {
  it('keeps the approved 20 portrait identities available without rendering idle personas', () => {
    expect(KIRA_ROSTER.map(agent => agent.name)).toEqual([
      'Vórtice', 'Aurora', 'Atlas', 'Nova', 'Lumen',
      'Helix', 'Prisma', 'Orión', 'Vega', 'Eclipse',
      'Argo', 'Solaria', 'Nexo', 'Astra', 'Lyra',
      'Zenith', 'Cobalto', 'Quasar', 'Senda', 'Órbita',
    ])

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

    expect(cards).toHaveLength(1)
    expect(cards[0]?.summary?.id).toBe(sid('c1'))
    expect(cards[0]?.name).toBe('Vega')
    expect(cards[0]?.kind).toBe('vega')
  })

  it('keeps simultaneous live agents individually identifiable even when hashes collide', () => {
    const one = summary({ id: sid('ab'), parentId: sid('root'), origin: 'subagent', running: true })
    const two = summary({ id: sid('ba'), parentId: sid('root'), origin: 'subagent', running: true })
    const cards = liveCardsOf([
      { summary: one, depth: 1 },
      { summary: two, depth: 1 },
    ])

    expect(cards).toHaveLength(2)
    expect(new Set(cards.map(card => card.kind)).size).toBe(2)
    expect(cards.map(card => card.summary?.id)).toEqual([sid('ab'), sid('ba')])
  })

  it('calls every agent AI while exposing the real duty separately', () => {
    expect(es['role.agent']).toBe('AI')
    expect(en['role.agent']).toBe('AI')
    expect(zh['role.agent']).toBe('AI')

    const judge = summary({
      id: sid('judge'),
      projectionValues: { subagent: { mode: 'continuable', label: 'independent quality judge', seq: 1 } },
    })
    const supervisor = summary({
      id: sid('supervisor'),
      projectionValues: { subagent: { mode: 'continuable', label: 'mission supervisor and orchestrator', seq: 2 } },
    })
    const coder = summary({
      id: sid('coder'),
      projectionValues: { subagent: { mode: 'continuable', label: 'fix code and debug implementation', seq: 3 } },
    })
    const tester = summary({
      id: sid('tester'),
      projectionValues: { subagent: { mode: 'continuable', label: 'QA tester', seq: 4 } },
    })

    expect(agentRoleKeyOf(judge)).toBe('role.judge')
    expect(agentRoleKeyOf(supervisor)).toBe('role.supervisor')
    expect(agentRoleKeyOf(coder)).toBe('role.coder')
    expect(agentRoleKeyOf(tester)).toBe('role.tester')
  })

  it('describes what each running agent is actually doing', () => {
    const judge = summary({ id: sid('judge'), running: true, projectionValues: { subagent: { mode: 'continuable', label: 'judge output quality', seq: 5 } } })
    const supervisor = summary({ id: sid('supervisor'), running: true, projectionValues: { subagent: { mode: 'continuable', label: 'supervisor', seq: 6 } } })
    const coder = summary({
      id: sid('coder'), running: true,
      projectionValues: {
        subagent: { mode: 'continuable', label: 'fixing code', seq: 7 },
        subagentActivity: { model: 'gpt-5.6-sol', phase: 'running-tools' },
      },
    })
    const researcher = summary({ id: sid('research'), running: true, projectionValues: { subagent: { mode: 'continuable', label: 'researcher', seq: 8 } } })

    expect(performanceKeyOf(judge)).toBe('performance.judging')
    expect(performanceKeyOf(supervisor)).toBe('performance.supervising')
    expect(performanceKeyOf(coder)).toBe('performance.coding')
    expect(performanceKeyOf(researcher)).toBe('performance.researching')
  })

  it('shows a runtime-idle live agent as ready while preserving unknown telemetry as working', () => {
    const ready = summary({
      id: sid('ready'), parentId: sid('root'), origin: 'subagent', running: true,
      projectionValues: { subagentActivity: { model: 'gpt-5.6-luna', phase: 'idle' } },
    })
    const working = summary({ id: sid('working'), parentId: sid('root'), origin: 'subagent', running: true })

    expect(activityKeyOf(ready)).toBe('activity.ready')
    expect(activityKeyOf(working)).toBe('activity.working')
  })

  it('floats above the conversation and renders only the currently live agent', () => {
    const root = summary({ id: sid('root') })
    const supervisor = summary({
      id: sid('supervisor-live'), parentId: root.id, origin: 'subagent', running: true,
      projectionValues: {
        subagent: { mode: 'continuable', label: 'mission supervisor', seq: 1 },
        subagentActivity: { model: 'gpt-5.6-luna', phase: 'preparing' },
      },
    })
    const state = {
      current: root.id,
      byId: { [String(root.id)]: root, [String(supervisor.id)]: supervisor },
    } as unknown as SessionListState
    const setWorkspaceOccupant = vi.fn()
    const props = {
      list: { getSnapshot: () => state, subscribe: () => () => undefined },
      layout: { setWorkspaceOccupant },
      openChild: vi.fn(),
      refresh: vi.fn(),
      t: translate,
    } as unknown as KiraTeamsDockProps

    const { container } = render(<KiraTeamsDock {...props} />)

    expect(container.querySelector('[data-kira-layout]')?.getAttribute('data-kira-layout')).toBe('floating-live')
    expect(setWorkspaceOccupant).toHaveBeenCalledWith('subagent', false)
    expect(container.querySelectorAll('[data-kira-agent-card]')).toHaveLength(1)
    expect(screen.getByText('Supervisor')).toBeTruthy()
    expect(screen.getByText('Preparando')).toBeTruthy()
    expect(screen.getByText('Supervisando misión')).toBeTruthy()
  })
})

describe('individual KIRA portrait assets', () => {
  it('embeds all 20 approved persona portraits as independent image payloads', () => {
    expect(portraitSrcForKind('vortice')).toMatch(/^data:image\/webp;base64,/)
    expect(portraitSrcForKind('argo')).toMatch(/^data:image\/webp;base64,/)
    expect(portraitSrcForKind('orbita')).toMatch(/^data:image\/webp;base64,/)
    const portraitSources = KIRA_ROSTER.map(agent => portraitSrcForKind(agent.kind))
    expect(new Set(portraitSources).size).toBe(20)
    expect(portraitSources.every(source => source.length > 1000)).toBe(true)
  })

  it('renders the individual portrait while keeping live phase data for animation', () => {
    const ready = ModelActivityAvatar({ kind: 'argo', activity: undefined, running: false, pending: false, ready: true, variant: 'card' })
    const live = ModelActivityAvatar({
      kind: 'atlas', activity: { model: 'gpt-5.6-luna', phase: 'running-tools' }, running: true, pending: false, variant: 'card',
    })
    const readyChildren = Array.isArray(ready.props.children) ? ready.props.children : [ready.props.children]
    const liveChildren = Array.isArray(live.props.children) ? live.props.children : [live.props.children]
    const readyPortrait = readyChildren.find((child: { props?: Record<string, unknown> }) => child?.props?.['data-agent-portrait-image'] === true)
    const livePortrait = liveChildren.find((child: { props?: Record<string, unknown> }) => child?.props?.['data-agent-portrait-image'] === true)

    expect(ready.props).toMatchObject({ 'data-avatar': 'argo', 'data-phase': 'idle', 'data-state': 'ready' })
    expect(readyPortrait?.type).toBe('img')
    expect(readyPortrait?.props?.src).toBe(portraitSrcForKind('argo'))
    expect(live.props).toMatchObject({ 'data-avatar': 'atlas', 'data-phase': 'running-tools', 'data-state': 'running' })
    expect(livePortrait?.type).toBe('img')
    expect(livePortrait?.props?.src).toBe(portraitSrcForKind('atlas'))
  })
})
