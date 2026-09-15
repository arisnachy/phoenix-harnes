import { describe, expect, test } from 'vitest'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { Inbox } from '@phoenix-ai/dsh-agent'
import { Context } from '@phoenix-ai/cordis'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import { QualityLedger } from '../src/quality.ts'

function stubAgent(rawId: string): Agent {
  const session = Session.create(SessionId(rawId))
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

describe('QualityLedger', () => {
  test('persists a revision-bound assessment and replays it in a fresh ledger', () => {
    const agent = stubAgent('quality-replay')
    const first = new QualityLedger().start(agent, {
      objective: 'Ship a resilient service',
      taskClass: 'substantial',
      goalId: 'goal-1',
      goalRevision: 3,
    })

    const second = new QualityLedger().record(agent, { id: first.id, revision: first.revision }, {
      kind: 'criterion',
      criterion: {
        id: 'REQ-1', text: 'service starts', tier: 'requested', mandatory: true,
        status: 'verified', evidence: ['test:start'],
      },
    })

    expect(second.revision).toBe(2)
    expect(second.criteria).toHaveLength(1)
    expect(agent.session.events.map(event => event.type)).toEqual(['quality/change', 'quality/change'])

    const replayed = new QualityLedger().get(agent)
    expect(replayed).toEqual(second)
  })

  test('rejects a stale quality revision instead of overwriting newer evidence', () => {
    const agent = stubAgent('quality-cas')
    const ledger = new QualityLedger()
    const first = ledger.start(agent, {
      objective: 'Ship a resilient service',
      taskClass: 'substantial',
      goalId: 'goal-1',
      goalRevision: 1,
    })
    ledger.record(agent, { id: first.id, revision: first.revision }, {
      kind: 'required-change', value: 'handle restart',
    })

    expect(() => ledger.record(agent, { id: first.id, revision: first.revision }, {
      kind: 'innovation', innovation: { status: 'not-applicable', rationale: 'None adds value.' },
    })).toThrow(/stale quality revision/i)
  })

  test('keeps forecasts hypothetical and stores innovation independently from requested criteria', () => {
    const agent = stubAgent('quality-forecast')
    const ledger = new QualityLedger()
    let snapshot = ledger.start(agent, {
      objective: 'Operate under load', taskClass: 'living', goalId: 'goal-2', goalRevision: 4,
    })
    snapshot = ledger.record(agent, { id: snapshot.id, revision: snapshot.revision }, {
      kind: 'forecast',
      forecast: {
        id: 'RISK-1', scenario: 'queue saturation', likelihood: 'high', confidence: 'medium', impact: 'high',
        evidence: ['metric:arrival-rate'], mitigation: 'scale workers before 80% saturation', status: 'open',
      },
    })
    snapshot = ledger.record(agent, { id: snapshot.id, revision: snapshot.revision }, {
      kind: 'innovation', innovation: { status: 'offered', rationale: 'Add saturation early warning.' },
    })

    expect(snapshot.forecasts[0]?.status).toBe('open')
    expect(snapshot.innovation?.status).toBe('offered')
    expect(snapshot.criteria).toEqual([])
  })
})
