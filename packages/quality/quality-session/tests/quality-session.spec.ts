import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import QualitySessionService from '../src/index.ts'

function stubAgentForSession(session: Session): Agent {
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
}

async function harness(session = Session.create(SessionId(`quality-${Math.random()}`))) {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(QualitySessionService)
  const agent = stubAgentForSession(session)
  ctx.agents.register(agent)
  return { ctx, agent, session }
}

describe('QualitySessionService', () => {
  test('persists whole revision-bound snapshots and replays them from the session log', async () => {
    const first = await harness()
    const started = first.ctx.quality.start(first.agent, {
      objective: '  ship a resilient service  ',
      taskClass: 'substantial',
    })
    expect(started).toMatchObject({ revision: 1, objective: 'ship a resilient service', taskClass: 'substantial' })
    expect(first.session.events.map(event => event.type)).toEqual(['quality/change'])

    const updated = first.ctx.quality.record(first.agent, started, {
      kind: 'criterion',
      value: {
        id: 'REQ-1', text: 'Service starts', tier: 'requested', mandatory: true,
        status: 'verified', evidence: ['test:start'],
      },
    })
    expect(updated.revision).toBe(2)
    expect(updated.criteria).toHaveLength(1)
    expect(first.session.events.map(event => event.type)).toEqual(['quality/change', 'quality/change'])

    const replaySession = Session.create(SessionId('quality-replay'), first.session.events)
    const replay = await harness(replaySession)
    expect(replay.ctx.quality.get(replay.agent)).toMatchObject({
      revision: 2,
      objective: 'ship a resilient service',
      criteria: [{ id: 'REQ-1', status: 'verified' }],
    })
  })

  test('rejects a stale compare-and-set revision', async () => {
    const { ctx, agent } = await harness()
    const started = ctx.quality.start(agent, { objective: 'ship', taskClass: 'bounded' })
    const current = ctx.quality.record(agent, started, {
      kind: 'required-changes', value: ['fix restart recovery'],
    })
    expect(current.revision).toBe(2)
    expect(() => ctx.quality.record(agent, started, {
      kind: 'required-changes', value: [],
    })).toThrow(/stale quality assessment ref/i)
  })

  test('restores state in a fresh provider over the same durable events', async () => {
    const first = await harness()
    const started = first.ctx.quality.start(first.agent, { objective: 'observe reality', taskClass: 'living' })
    first.ctx.quality.record(first.agent, started, {
      kind: 'innovation',
      value: { status: 'not-applicable', rationale: 'No useful extra feature.', evidence: [] },
    })

    const restored = Session.create(SessionId('quality-restored'), first.session.events)
    const second = await harness(restored)
    expect(second.ctx.quality.get(second.agent)?.innovation).toEqual({
      status: 'not-applicable', rationale: 'No useful extra feature.', evidence: [],
    })
  })
})
