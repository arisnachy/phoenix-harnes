/** ui-kira-teams browser half: overlay registration, injected actions, lineage read model. */
import { Context } from '@phoenix-ai/cordis'
import { stubSettingsScope } from '@phoenix-ai/dsh-client-test-runtime'
import { describe, expect, it } from 'vitest'
import {
  SlotRegistry, type SessionId, type SessionListState,
  type SessionSummary, type SubagentAddress,
} from '@phoenix-ai/dsh-client-runtime/client'
import { apply as applyLocale, inject as localeInject } from '@phoenix-ai/dsh-client-locale/client'
import { activityOf, KiraTeamsDock, lineageMembers } from '../src/client/KiraTeamsDock.tsx'
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
      'shell.overlay': { kind: 'list', scope: 'root' },
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
  await provideSlotFaces(ctx)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { face, ctx }
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
  // Foreign lineage and ordinary forks stay out of the board.
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
  })

  it('collects only the current lineage subagents with depths, root-walking through children', () => {
    // Selected session is a grandchild: the walk climbs to the ordinary root.
    const { root, rows } = lineageMembers(
      sessionsWith(FAMILY, sid('g1')).list.getSnapshot(),
    )
    expect(root?.id).toBe(sid('root'))
    expect(rows.map(row => row.summary.id)).toEqual([sid('c1'), sid('c2'), sid('g1')])
    expect(rows.map(row => row.depth)).toEqual([1, 1, 2])
  })

  it('returns nothing without a current session', () => {
    const { root, rows } = lineageMembers(
      sessionsWith(FAMILY).list.getSnapshot(),
    )
    expect(root).toBeUndefined()
    expect(rows).toEqual([])
  })
})

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['sessions', 'slots', 'locale'])
  })

  it('registers one shell.overlay entry whose inject exposes the sessions face and actions', async () => {
    const { ctx, face } = await fullBench(FAMILY, sid('root'))
    const entry = ctx.slots.entries('shell.overlay')
      .find(slotEntry => slotEntry.component === KiraTeamsDock)!
    expect(entry).toBeDefined()
    const injected = (entry.inject as unknown as () => {
      list: { getSnapshot(): SessionListState }
      openChild: (address: SubagentAddress) => void
      refresh: (parentSessionId: SessionId) => void
    })()
    expect(injected.list.getSnapshot().current).toBe(sid('root'))
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
