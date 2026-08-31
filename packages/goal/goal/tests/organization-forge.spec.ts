import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import GoalService, { OrganizationForgeLedger, foldOrganizationForge } from '@phoenix-ai/dsh-goal'

function agentFor(session: Session): Agent {
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
    inject: input => inbox.append('next-step', input),
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(GoalService)
  const session = Session.create(SessionId(`forge-test-${Math.random()}`))
  const agent = agentFor(session)
  ctx.agents.register(agent)
  return { ctx, agent, session }
}

describe('OrganizationForgeLedger', () => {
  it('keeps research, audits, evidence, judge, and management durable', async () => {
    const { ctx, agent, session } = await harness()
    const ledger = new OrganizationForgeLedger()
    let forge = ledger.start(agent, { objective: 'Build a secure operations platform' })
    expect(forge).toMatchObject({ phase: 'researching', revision: 1, teams: { it: true, security: true, rd: true } })

    forge = ledger.addSource(agent, forge.id, {
      title: 'Comparable project',
      locator: 'https://github.com/example/project',
      license: 'MIT',
    })
    expect(forge.phase).toBe('auditing')
    const source = forge.sources[0]
    if (source === undefined) throw new Error('expected a source')

    forge = ledger.addAudit(agent, forge.id, {
      stage: 'pre-reuse',
      sourceId: source.id,
      license: 'passed',
      dependencies: 'passed',
      secrets: 'passed',
      vulnerabilities: 'passed',
    })
    expect(forge.sources[0]?.auditStatus).toBe('passed')
    expect(forge.phase).toBe('designing')
    forge = ledger.addAudit(agent, forge.id, {
      stage: 'post-modification',
      sourceId: source.id,
      license: 'passed',
      dependencies: 'passed',
      secrets: 'passed',
      vulnerabilities: 'passed',
    })
    forge = ledger.advance(agent, forge.id, 'building')
    forge = ledger.advance(agent, forge.id, 'verifying')

    for (const criterion of forge.criteria) {
      forge = ledger.markCriterion(agent, forge.id, criterion.id, 'verified', [`test:${criterion.id}`])
    }
    forge = ledger.judge(agent, forge.id, {
      verdict: 'pass',
      summary: 'Every required criterion is verified.',
      findings: [],
      requiredChanges: [],
      reviewedAt: Date.now(),
    })
    expect(forge.phase).toBe('ready')
    forge = ledger.setManagementMode(agent, forge.id, 'assisted')
    expect(forge.managementMode).toBe('assisted')
    expect(foldOrganizationForge(session.events).get(forge.id)).toEqual(forge)
    expect(session.events.map(event => event.type)).toEqual(Array.from({ length: 1 + 1 + 1 + 1 + 1 + 1 + 6 + 1 + 1 }, () => 'organization-forge/change'))
    expect(ctx.goals.organizationForge.get(agent, forge.id)).toEqual(forge)
  })

  it('does not expose a ready build after a judge rejection or unsafe source', async () => {
    const { agent } = await harness()
    const ledger = new OrganizationForgeLedger()
    const started = ledger.start(agent, { objective: 'Build a reviewed system', criteria: ['functional'] })
    expect(() => ledger.addSource(agent, started.id, {
      title: 'Credential leak',
      locator: 'https://example.test/repo?api_key=secret',
      license: 'MIT',
    })).toThrow('without credentials')

    let forge = ledger.addSource(agent, started.id, {
      title: 'Audited baseline',
      locator: 'local:baseline',
      license: 'original',
    })
    const source = forge.sources[0]
    if (source === undefined) throw new Error('expected a source')
    forge = ledger.addAudit(agent, forge.id, {
      stage: 'pre-reuse', sourceId: source.id, license: 'passed', dependencies: 'passed', secrets: 'passed', vulnerabilities: 'passed',
    })
    forge = ledger.addAudit(agent, forge.id, {
      stage: 'post-modification', sourceId: source.id, license: 'passed', dependencies: 'passed', secrets: 'passed', vulnerabilities: 'passed',
    })
    forge = ledger.advance(agent, started.id, 'verifying')
    forge = ledger.judge(agent, forge.id, {
      verdict: 'needs_changes',
      summary: 'The implementation is incomplete.',
      findings: ['No evidence for the required criterion.'],
      requiredChanges: ['Complete and verify the criterion.'],
      reviewedAt: Date.now(),
    })
    expect(forge.phase).toBe('verifying')
    expect(() => ledger.setManagementMode(agent, forge.id, 'handoff')).toThrow('passing Forge judge')
  })
})
