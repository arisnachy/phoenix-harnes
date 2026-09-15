/** ui-kira-teams browser half: workspace registration, injected actions, lineage read model. */
import { Context } from '@phoenix-ai/cordis'
import { stubSettingsScope } from '@phoenix-ai/dsh-client-test-runtime'
import { describe, expect, it } from 'vitest'
import {
  SlotRegistry, type SessionId, type SessionListState,
  type SessionSummary, type SubagentAddress,
} from '@phoenix-ai/dsh-client-runtime/client'
import { apply as applyLocale, inject as localeInject } from '@phoenix-ai/dsh-client-locale/client'
import {
  activityKeyOf, activityOf, agentNameOf, agentRoleKeyOf,
  KiraTeamsDock, lineageMembers, statusKeyOf,
} from '../src/client/KiraTeamsDock.tsx'
import { agentAvatarKind } from '../src/client/ModelActivityAvatar.tsx'
import { apply, inject } from '../src/client/index.ts'

function summary(partial: Partial<SessionSummary> & { id: SessionId }): SessionSummary {
  return {
    displayTitle: partial.id,
    running: false,
    updatedAt: 0,
    ...partial,
  } as SessionSummary
}

const sid = (id: string) => id as SessionId

/** Fake root sessions face for dock actions. */
function sessionsWith(sessions: SessionSummary[], current?: SessionId) {
  const byId: Record<string, SessionSummary> = {}
  for (const s of sessions) byId[s.id] = s
  const snapshot = {
    ids: sessions.map(s => s.id), byId, current,
    subagentsByParent: {}, jobsBySession: {}, phase: 'ready',
  } as unknown as SessionListState
  const actionCalls: { method: string; args: unknown[] }[] = []
  return {
    list: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    },
    actionCalls,
    openSubagent: (address: SubagentAddress) => {
      actionCalls.push({ method: 'openSubagent', args: [address] })
    },
    refreshSubagents: (parentSessionId: SessionId) => {
      actionCalls.push({ method: 'refreshSubagents', args: [parentSessionId] })
      return Promise.resolve()
    },
  }
}

async function provideSlotFaces(ctx: Context): Promise<void> {
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'shell.workspace': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

/** Boot the plugin over fake sessions and slot faces. */
async function fullBench(sessions: SessionSummary[], current?: SessionId) {
  const ctx = new Context()
  const face = sessionsWith(sessions, current)
  ctx.provide('sessions', face)
  ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
  ctx.provide('remote', { $on: () => () => {} } as never)
  ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
  const layout = {
    toggleSidebar() {},
    openDetails() {},
    closeDetails() {},
    setWorkspaceOccupant() {},
    getWorkspaceOccupancy: () => ({ subagent: false, cordis: false }),
    subscribeWorkspaceOccupancy: () => () => {},
  }
  ctx.provide('layout', layout as never)
  await provideSlotFaces(ctx)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { face, ctx, layout }
}

const FAMILY: SessionSummary[] = [
  summary({ id: sid('root'), displayTitle: 'Misión raíz', running: true }),
  summary({
    id: sid('c1'),
    parentId: sid('root'),
    origin: 'subagent',
    displayTitle: 'VEGA-1',
    running: true,
    agentPreset: 'luna',
    projectionValues: {
      subagentActivity: {
        provider: 'openai-codex',
        model: 'gpt-5.6-luna',
        phase: 'running-tools',
      },
    },
  }),
  summary({ id: sid('g1'), parentId: sid('c1'), origin: 'subagent', displayTitle: 'nieto', running: false }),
  summary({ id: sid('c2'), parentId: sid('root'), origin: 'subagent', displayTitle: 'CONSTELACIÓN-2', running: false }),
  summary({ id: sid('x1'), parentId: sid('other'), origin: 'subagent', displayTitle: 'otro-equipo', running: true }),
  summary({ id: sid('f1'), parentId: sid('root'), displayTitle: 'fork-ordinario', running: true }),
]

describe('lineageMembers', () => {
  it('reads the durable child model activity projection', () => {
    const child = FAMILY.find(item => item.id === sid('c1'))!
    expect(activityOf(child)).toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      phase: 'running-tools',
    })
    expect(agentNameOf(child)).toBe('Vega')
    expect(agentNameOf(FAMILY.find(item => item.id === sid('c2'))!)).toBe('Eclipse')
  })

  it('maps activity phases to visible status labels without exposing prompts', () => {
    const verifying = summary({
      id: sid('verifying'), parentId: sid('root'), origin: 'subagent', running: true,
      projectionValues: { subagentActivity: { model: 'gpt-5.6-luna', phase: 'verifying' } },
    })
    const preparing = summary({ id: sid('preparing'), parentId: sid('root'), origin: 'subagent', running: true })
    const waiting = summary({
      id: sid('waiting'), parentId: sid('root'), origin: 'subagent',
      running: false, pendingInteraction: 'question',
    })
    const done = summary({ id: sid('done'), parentId: sid('root'), origin: 'subagent', running: false })
    expect(statusKeyOf(FAMILY.find(item => item.id === sid('c1'))!)).toBe('status.tools')
    expect(statusKeyOf(verifying)).toBe('status.verifying')
    expect(statusKeyOf(preparing)).toBe('status.preparing')
    expect(statusKeyOf(waiting)).toBe('status.waiting')
    expect(statusKeyOf(done)).toBe('status.done')
  })

  it('derives a visible team role from the durable subagent label', () => {
    const judge = summary({
      id: sid('judge'), parentId: sid('root'), origin: 'subagent', running: true,
      projectionValues: {
        subagent: { mode: 'continuable', label: 'Juez de calidad', seq: 1 },
        subagentActivity: { phase: 'verifying' },
      },
    })
    const researcher = summary({
      id: sid('research'), parentId: sid('root'), origin: 'subagent', running: true,
      projectionValues: {
        subagent: { mode: 'continuable', label: 'Investigador de referencias', seq: 2 },
        subagentActivity: { phase: 'running-tools' },
      },
    })
    const generic = summary({ id: sid('generic'), parentId: sid('root'), origin: 'subagent', running: true })
    expect(agentRoleKeyOf(judge)).toBe('role.judge')
    expect(agentRoleKeyOf(researcher)).toBe('role.researcher')
    expect(agentRoleKeyOf(generic)).toBe('role.agent')
  })

  it('exposes the current action independently from the role', () => {
    const verifying = summary({
      id: sid('verifying-action'), parentId: sid('root'), origin: 'subagent', running: true,
      projectionValues: { subagentActivity: { phase: 'verifying' } },
    })
    const waiting = summary({
      id: sid('waiting-action'), parentId: sid('root'), origin: 'subagent', running: false,
      pendingInteraction: 'question',
    })
    const done = summary({ id: sid('done-action'), parentId: sid('root'), origin: 'subagent', running: false })
    expect(activityKeyOf(FAMILY.find(item => item.id === sid('c1'))!)).toBe('activity.tools')
    expect(activityKeyOf(verifying)).toBe('activity.verifying')
    expect(activityKeyOf(waiting)).toBe('activity.waiting')
    expect(activityKeyOf(done)).toBe('activity.done')
  })

  it('assigns the approved 20-portrait avatar roster by agent id', () => {
    expect(agentAvatarKind('c1')).toBe('vega')
    expect(agentAvatarKind('c2')).toBe('eclipse')
    expect(agentAvatarKind('c1')).not.toBe(agentAvatarKind('c2'))
  })

  it('collects only the current lineage subagents with depths, root-walking through children', () => {
    const { root, rows } = lineageMembers(
      sessionsWith(FAMILY, sid('g1')).list.getSnapshot(),
    )
    expect(root?.id).toBe(sid('root'))
    expect(rows.map(row => row.summary.id)).toEqual([sid('c1')])
    expect(rows.map(row => row.depth)).toEqual([1])
  })

  it('returns nothing without a current session', () => {
    const { root, rows } = lineageMembers(
      sessionsWith(FAMILY).list.getSnapshot(),
    )
    expect(root).toBeUndefined()
    expect(rows).toEqual([])
  })

  it('removes settled children from the active team roster', () => {
    const { rows } = lineageMembers(
      sessionsWith([
        summary({ id: sid('root') }),
        summary({ id: sid('done'), parentId: sid('root'), origin: 'subagent', running: false }),
      ], sid('root')).list.getSnapshot(),
    )
    expect(rows).toEqual([])
  })

  it('keeps agents awaiting interaction visible even when execution is paused', () => {
    const { rows } = lineageMembers(
      sessionsWith([
        summary({ id: sid('root') }),
        summary({
          id: sid('waiting'), parentId: sid('root'), origin: 'subagent',
          running: false, pendingInteraction: 'question',
        }),
      ], sid('root')).list.getSnapshot(),
    )
    expect(rows.map(row => row.summary.id)).toEqual([sid('waiting')])
  })
})

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['sessions', 'slots', 'locale', 'layout'])
  })

  it('registers one shell.workspace entry whose inject exposes the sessions face and actions', async () => {
    const { ctx, face, layout } = await fullBench(FAMILY, sid('root'))
    const entry = ctx.slots.entries('shell.workspace')
      .find(slotEntry => slotEntry.component === KiraTeamsDock)!
    expect(entry).toBeDefined()
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
    const injected = (entry.inject as unknown as () => {
      list: { getSnapshot(): SessionListState }
      layout: unknown
      openChild: (address: SubagentAddress) => void
      refresh: (parentSessionId: SessionId) => void
    })()
    expect(injected.list.getSnapshot().current).toBe(sid('root'))
    expect(injected.layout).toBe(layout)
    const address: SubagentAddress = {
      parentSessionId: sid('root'),
      childSessionId: sid('c1'),
      mode: 'continuable',
    }
    injected.openChild(address)
    injected.refresh(sid('root'))
    expect(face.actionCalls).toEqual([
      { method: 'openSubagent', args: [address] },
      { method: 'refreshSubagents', args: [sid('root')] },
    ])
  })
})
