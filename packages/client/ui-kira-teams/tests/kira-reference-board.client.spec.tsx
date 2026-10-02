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
  skillOf,
  isVisibleAgentSummary,
  kiraTeamSpecialistOf,
  liveActivityTextOf,
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
        subagent: { mode: 'continuable', label: 'creative UI designer', seq: 1 },
        subagentActivity: { model: 'gpt-5.6-luna', phase: 'running-tools' },
      },
    })
    const cards = liveCardsOf([{ summary: active, depth: 1 }])

    expect(cards).toHaveLength(1)
    expect(cards[0]?.summary?.id).toBe(sid('c1'))
    expect(cards[0]?.name).toBe('Vega')
    expect(cards[0]?.kind).toBe('vega')
    expect(skillOf(active)).toBe('design')
  })

  it('keeps a real Team codename aligned with the same KIRA persona used in chat', () => {
    const teammate = summary({
      id: sid('team-worker'),
      parentId: sid('root'),
      origin: 'subagent',
      running: true,
      projectionValues: {
        subagent: {
          mode: 'continuable',
          label: 'KIRA:la-forja · typescript engineer fixing code',
          seq: 10,
        },
      },
    })
    const [card] = liveCardsOf([{ summary: teammate, depth: 1 }])
    expect(card).toMatchObject({ name: 'La Forja', kind: 'atlas' })
    expect(kiraTeamSpecialistOf('la-forja', 'typescript engineer fixing code'))
      .toMatchObject({ name: 'La Forja', kind: 'atlas' })
    expect(kiraTeamSpecialistOf('nova', 'typescript engineer fixing code'))
      .toMatchObject({ name: 'Nova', kind: 'nova' })
  })

  it('assigns specialist identities from the requested capability instead of agent-id randomness', () => {
    const coder = summary({
      id: sid('random-id-a'), parentId: sid('root'), origin: 'subagent', running: true,
      projectionValues: { subagent: { mode: 'continuable', label: 'typescript engineer fixing code', seq: 11 } },
    })
    const tester = summary({
      id: sid('random-id-b'), parentId: sid('root'), origin: 'subagent', running: true,
      projectionValues: { subagent: { mode: 'continuable', label: 'playtest QA gameplay', seq: 12 } },
    })
    const researcher = summary({
      id: sid('random-id-c'), parentId: sid('root'), origin: 'subagent', running: true,
      projectionValues: { subagent: { mode: 'continuable', label: 'research evidence and references', seq: 13 } },
    })

    const cards = liveCardsOf([
      { summary: coder, depth: 1 },
      { summary: tester, depth: 1 },
      { summary: researcher, depth: 1 },
    ])

    expect(cards.map(card => card.name)).toEqual(['Atlas', 'Orión', 'Nova'])
    expect(skillOf(coder)).toBe('engineering')
    expect(skillOf(tester)).toBe('testing')
    expect(skillOf(researcher)).toBe('research')
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

  it('shows only the child model text and never falls back to parent-authored labels', () => {
    const authored = summary({
      id: sid('real-task'),
      running: true,
      displayTitle: 'fallback title',
      projectionValues: {
        subagent: {
          mode: 'continuable',
          label: 'parent-authored delegation label',
          seq: 9,
        },
        subagentActivity: {
          model: 'gpt-5.6-luna',
          phase: 'running-tools',
          text: 'Abriré lunaris-quest.html en el navegador para comprobar la carga.',
        },
      },
    })
    const withoutAuthoredText = summary({
      id: sid('no-agent-text'),
      running: true,
      displayTitle: 'fallback title',
      projectionValues: {
        subagent: { mode: 'continuable', label: 'parent-authored delegation label', seq: 10 },
        subagentActivity: { model: 'gpt-5.6-luna', phase: 'preparing' },
      },
    })

    const text = liveActivityTextOf(authored, 58)
    expect(text.startsWith('Abriré lunaris-quest.html')).toBe(true)
    expect(text.length).toBeLessThanOrEqual(58)
    expect(liveActivityTextOf(withoutAuthoredText)).toBe('')
  })

  it('does not rewrite grammar authored by the child', () => {
    const runtime = summary({
      id: sid('runtime-action'),
      running: true,
      projectionValues: {
        subagentActivity: {
          model: 'gpt-5.6-luna',
          phase: 'running-tools',
          text: 'Estoy revisando la página cargada',
        },
      },
    })

    expect(liveActivityTextOf(runtime)).toBe('Estoy revisando la página cargada')
  })

  it('does not duplicate a generic authored word when it equals the visible state', () => {
    const root = summary({ id: sid('root-duplicate') })
    const child = summary({
      id: sid('child-duplicate'), parentId: root.id, origin: 'subagent', running: true,
      projectionValues: {
        subagent: { mode: 'continuable', label: 'support check', seq: 1 },
        subagentActivity: {
          model: 'gpt-5.6-luna',
          phase: 'preparing',
          text: 'Preparando',
        },
      },
    })
    const state = {
      current: root.id,
      byId: { [String(root.id)]: root, [String(child.id)]: child },
    } as unknown as SessionListState
    const props = {
      list: { getSnapshot: () => state, subscribe: () => () => undefined },
      layout: { setWorkspaceOccupant: vi.fn() },
      openChild: vi.fn(),
      refresh: vi.fn(),
      t: translate,
    } as unknown as KiraTeamsDockProps

    render(<KiraTeamsDock {...props} />)
    expect(screen.getAllByText('Preparando')).toHaveLength(1)
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

  it('treats idle or completed subagents as absent from the live dock', () => {
    const idle = summary({
      id: sid('idle'), parentId: sid('root'), origin: 'subagent', running: true,
      projectionValues: { subagentActivity: { model: 'gpt-5.6-luna', phase: 'idle' } },
    })
    const completed = summary({
      id: sid('completed'), parentId: sid('root'), origin: 'subagent', running: false,
      projectionValues: { subagentActivity: { model: 'gpt-5.6-luna', phase: 'verifying' } },
    })
    const working = summary({ id: sid('working'), parentId: sid('root'), origin: 'subagent', running: true })

    expect(activityKeyOf(idle)).toBe('activity.ready')
    expect(isVisibleAgentSummary(idle)).toBe(false)
    expect(isVisibleAgentSummary(completed)).toBe(false)
    expect(isVisibleAgentSummary(working)).toBe(true)
  })

  it('removes the whole window when the last agent finishes or is stopped', () => {
    const root = summary({ id: sid('root') })
    const stopped = summary({
      id: sid('stopped'), parentId: root.id, origin: 'subagent', running: false,
      projectionValues: {
        subagent: { mode: 'continuable', label: 'playtest QA gameplay', seq: 20 },
        subagentActivity: { model: 'gpt-5.6-luna', phase: 'verifying' },
      },
    })
    const state = {
      current: root.id,
      byId: { [String(root.id)]: root, [String(stopped.id)]: stopped },
    } as unknown as SessionListState
    const props = {
      list: { getSnapshot: () => state, subscribe: () => () => undefined },
      layout: { setWorkspaceOccupant: vi.fn() },
      openChild: vi.fn(),
      refresh: vi.fn(),
      t: translate,
    } as unknown as KiraTeamsDockProps

    const { container } = render(<KiraTeamsDock {...props} />)
    expect(container.querySelector('[data-kira-teams]')).toBeNull()
  })

  it('uses the activity strip and rail for the currently live agent', () => {
    const root = summary({ id: sid('root') })
    const supervisor = summary({
      id: sid('supervisor-live'), parentId: root.id, origin: 'subagent', running: true,
      projectionValues: {
        subagent: { mode: 'continuable', label: 'mission supervisor', seq: 1 },
        subagentActivity: {
          model: 'gpt-5.6-luna',
          phase: 'preparing',
          text: 'Coordinaré la revisión breve del agente.',
        },
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

    expect(container.querySelector('[data-kira-layout]')?.getAttribute('data-kira-layout')).toBe('activity-rail')
    expect(setWorkspaceOccupant).toHaveBeenCalledWith('subagent', false)
    expect(container.querySelectorAll('[data-kira-agent-rail]')).toHaveLength(1)
    expect(screen.getByText('Coordinación / orquestación')).toBeTruthy()
    expect(screen.getByText('Preparando')).toBeTruthy()
    expect(screen.getByText('Coordinaré la revisión breve del agente.')).toBeTruthy()
  })

  it('caps the strip stack at three portraits while the rail keeps every live agent selectable', () => {
    const root = summary({ id: sid('root-many') })
    const children = Array.from({ length: 5 }, (_, index) => summary({
      id: sid(`child-${index}`),
      parentId: root.id,
      origin: 'subagent',
      running: true,
      projectionValues: {
        subagent: { mode: 'continuable', label: `research agent ${index}`, seq: index + 1 },
        subagentActivity: {
          model: 'gpt-5.6-luna',
          phase: 'running-tools',
          text: `Revisando fuente ${index + 1}`,
        },
      },
    }))
    const byId = Object.fromEntries([root, ...children].map(item => [String(item.id), item]))
    const state = { current: root.id, byId } as unknown as SessionListState
    const props = {
      list: { getSnapshot: () => state, subscribe: () => () => undefined },
      layout: { setWorkspaceOccupant: vi.fn() },
      openChild: vi.fn(),
      refresh: vi.fn(),
      t: translate,
    } as unknown as KiraTeamsDockProps

    const { container } = render(<KiraTeamsDock {...props} />)

    expect(container.querySelectorAll('[data-kira-stack-avatar]')).toHaveLength(3)
    expect(container.querySelector('[data-kira-stack-overflow]')?.textContent).toBe('+2')
    expect(container.querySelectorAll('[data-kira-agent-rail]')).toHaveLength(5)
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
