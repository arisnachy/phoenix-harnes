import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import GoalService, { GoalId, OrganizationForgeLedger, foldOrganizationForge } from '@phoenix-ai/dsh-goal'

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
    inject: (input) => { inbox.append('next-step', input) },
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

    forge = ledger.addResearch(agent, forge.id, {
      kind: 'repository',
      title: 'Comparable project',
      locator: 'https://github.com/example/project',
      summary: 'Public reference implementation',
      relevance: 'Operations workflow comparison',
    })

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
    forge = ledger.setBlueprint(agent, forge.id, {
      components: ['api'],
      infrastructure: ['local sandbox'],
      automations: ['daily check'],
      workflows: ['research-build-verify'],
      metrics: ['test pass rate'],
      costControls: ['deterministic checks'],
      qualityTargets: ['all required criteria verified'],
    })
    forge = ledger.addDeliverable(agent, forge.id, {
      name: 'working service',
      kind: 'software',
      artifactRef: 'artifact:service-v1',
    })
    const deliverable = forge.deliverables[0]
    if (deliverable === undefined) throw new Error('expected a deliverable')
    forge = ledger.markDeliverable(agent, forge.id, deliverable.id, 'verified', ['test:service'])
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
    expect(session.events.map(event => event.type)).toEqual(Array.from({ length: 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 6 + 1 + 1 }, () => 'organization-forge/change'))
    expect(ctx.goals.organizationForge.get(agent, forge.id)).toEqual(forge)
  })

  it('does not expose a ready build after a judge rejection or unsafe source', async () => {
    const { agent } = await harness()
    const ledger = new OrganizationForgeLedger()
    const started = ledger.start(agent, { objective: 'Build a reviewed system', criteria: ['functional'] })
    let forge = ledger.addResearch(agent, started.id, {
      kind: 'repository', title: 'Reviewed baseline', locator: 'local:baseline', summary: 'Local reference', relevance: 'Quality comparison',
    })
    expect(() => ledger.addSource(agent, started.id, {
      title: 'Credential leak',
      locator: 'https://example.test/repo?api_key=secret',
      license: 'MIT',
    })).toThrow('without credentials')

    forge = ledger.addSource(agent, started.id, {
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
    forge = ledger.setBlueprint(agent, forge.id, {
      components: ['service'], infrastructure: ['sandbox'], automations: ['health check'],
      workflows: ['build'], metrics: ['availability'], costControls: ['bounded retries'], qualityTargets: ['functional'],
    })
    forge = ledger.addDeliverable(agent, forge.id, { name: 'service', kind: 'software', artifactRef: 'artifact:service' })
    const deliverable = forge.deliverables[0]
    if (deliverable === undefined) throw new Error('expected a deliverable')
    forge = ledger.markDeliverable(agent, forge.id, deliverable.id, 'verified', ['test:service'])
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

  it('persists research, blueprint, and verified deliverables', async () => {
    const { agent, session } = await harness()
    const ledger = new OrganizationForgeLedger()
    let forge = ledger.start(agent, { objective: 'Build a durable operations platform', criteria: ['functional'] })

    forge = ledger.addResearch(agent, forge.id, {
      kind: 'repository',
      title: 'Comparable platform',
      locator: 'https://github.com/example/platform',
      summary: 'Public reference implementation',
      relevance: 'Workflow and deployment comparison',
    })
    forge = ledger.setBlueprint(agent, forge.id, {
      components: ['api'],
      infrastructure: ['local sandbox'],
      automations: ['daily check'],
      workflows: ['research-build-verify'],
      metrics: ['test pass rate'],
      costControls: ['deterministic checks'],
      qualityTargets: ['all required criteria verified'],
    })
    forge = ledger.addDeliverable(agent, forge.id, {
      name: 'working service',
      kind: 'software',
      artifactRef: 'artifact:service-v1',
    })
    const deliverable = forge.deliverables[0]
    if (deliverable === undefined) throw new Error('expected a Forge deliverable')
    forge = ledger.markDeliverable(agent, forge.id, deliverable.id, 'verified', ['test:service', 'smoke:service'])

    expect(forge.research).toHaveLength(1)
    expect(forge.blueprint?.components).toEqual(['api'])
    expect(forge.deliverables[0]).toMatchObject({ status: 'verified', artifactRef: 'artifact:service-v1' })
    expect(foldOrganizationForge(session.events).get(forge.id)).toEqual(forge)
  })

  it('enforces research-first build gates and requires a verified deliverable', async () => {
    const { agent } = await harness()
    const ledger = new OrganizationForgeLedger()
    let forge = ledger.start(agent, { objective: 'Build an evidence-backed service', criteria: ['functional'] })

    expect(() => ledger.advance(agent, forge.id, 'designing')).toThrow('research evidence')
    forge = ledger.addResearch(agent, forge.id, {
      kind: 'tool',
      title: 'Comparable tool',
      locator: 'https://github.com/example/tool',
      summary: 'Public tool reference',
      relevance: 'Deployment comparison',
    })
    forge = ledger.addSource(agent, forge.id, {
      title: 'Audited source',
      locator: 'local:source',
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
    forge = ledger.advance(agent, forge.id, 'designing')
    expect(() => ledger.advance(agent, forge.id, 'building')).toThrow('blueprint')
    forge = ledger.setBlueprint(agent, forge.id, {
      components: ['service'], infrastructure: ['sandbox'], automations: ['health check'],
      workflows: ['build'], metrics: ['availability'], costControls: ['bounded retries'], qualityTargets: ['functional'],
    })
    forge = ledger.advance(agent, forge.id, 'building')
    expect(() => ledger.advance(agent, forge.id, 'verifying')).toThrow('deliverable')
    forge = ledger.addDeliverable(agent, forge.id, { name: 'service', kind: 'software', artifactRef: 'artifact:service' })
    const deliverable = forge.deliverables[0]
    if (deliverable === undefined) throw new Error('expected a deliverable')
    forge = ledger.markDeliverable(agent, forge.id, deliverable.id, 'verified', ['test:service'])
    expect(ledger.advance(agent, forge.id, 'verifying').phase).toBe('verifying')
  })

  it('retains failed work and strategies while requiring a different approach', async () => {
    const { agent } = await harness()
    const ledger = new OrganizationForgeLedger()
    let forge = ledger.start(agent, { objective: 'Recover from an unavailable tool', criteria: ['functional'] })
    forge = ledger.addWork(agent, forge.id, {
      role: 'it', title: 'Repair missing adapter', status: 'failed', failureFingerprint: 'missing-adapter', evidence: ['error:adapter'],
    })
    expect(forge.phase).not.toBe('blocked')
    forge = ledger.recordStrategy(agent, forge.id, {
      name: 'fallback', status: 'failed', failureFingerprint: 'missing-adapter', summary: 'Tool unavailable', evidence: ['work:failed'],
    })
    expect(forge.phase).not.toBe('blocked')
    expect(() => ledger.recordStrategy(agent, forge.id, {
      name: 'fallback', status: 'failed', failureFingerprint: 'missing-adapter', summary: 'Same approach', evidence: ['work:failed'],
    })).toThrow('different strategy')
    forge = ledger.judge(agent, forge.id, {
      verdict: 'needs_changes', summary: 'Repair is required.', findings: ['Adapter is missing'], requiredChanges: ['Use a different adapter'], reviewedAt: Date.now(),
    })
    expect(forge.work).toHaveLength(2)
    expect(forge.strategies).toHaveLength(1)
    expect(ledger.activeWork(forge)).toHaveLength(1)
    expect(forge.work[1]).toMatchObject({ status: 'active', title: 'Use a different adapter' })
  })

  it('revalidates audited sources before publishing sanitized Atlas metadata', async () => {
    const { agent } = await harness()
    const ledger = new OrganizationForgeLedger()
    let forge = ledger.start(agent, { objective: 'Publish a reusable pattern', criteria: ['secure'] })
    forge = ledger.addResearch(agent, forge.id, {
      kind: 'pattern', title: 'Reusable pattern', locator: 'atlas:pattern', summary: 'Reusable workflow', relevance: 'Shared automation',
    })
    forge = ledger.addSource(agent, forge.id, { title: 'Source', locator: 'local:source', license: 'original' })
    const source = forge.sources[0]
    if (source === undefined) throw new Error('expected a source')
    forge = ledger.addAudit(agent, forge.id, {
      stage: 'pre-reuse', sourceId: source.id, license: 'passed', dependencies: 'passed', secrets: 'passed', vulnerabilities: 'passed',
    })
    forge = ledger.addAudit(agent, forge.id, {
      stage: 'post-modification', sourceId: source.id, license: 'passed', dependencies: 'passed', secrets: 'passed', vulnerabilities: 'passed',
    })
    expect(() => ledger.publishAtlasEntry(agent, forge.id, {
      name: 'unsafe', sourceId: source.id, summary: 'api_key: secret', reusablePattern: 'do not publish',
    })).toThrow('secret')
    forge = ledger.revalidateSource(agent, forge.id, { sourceId: source.id, evidence: ['review:source'] })
    forge = ledger.publishAtlasEntry(agent, forge.id, {
      name: 'safe pattern', sourceId: source.id, summary: 'Reusable workflow', reusablePattern: 'Run deterministic checks before deployment',
    })
    expect(forge.atlasEntries).toHaveLength(1)
    expect(forge.atlasEntries[0]).toMatchObject({ sourceId: source.id, name: 'safe pattern' })
  })

  it('persists the originating goal reference and resumes an external block', async () => {
    const { agent } = await harness()
    const ledger = new OrganizationForgeLedger()
    let forge = ledger.start(agent, {
      objective: 'Resume an externally blocked build',
      criteria: ['functional'],
      goalRef: { id: GoalId('goal-origin'), revision: 4 },
    })
    forge = ledger.addResearch(agent, forge.id, {
      kind: 'repository', title: 'Reference', locator: 'local:reference', summary: 'Reference', relevance: 'Comparison',
    })
    forge = ledger.addSource(agent, forge.id, { title: 'Source', locator: 'local:source', license: 'original' })
    const source = forge.sources[0]
    if (source === undefined) throw new Error('expected a source')
    forge = ledger.addAudit(agent, forge.id, {
      stage: 'pre-reuse', sourceId: source.id, license: 'passed', dependencies: 'passed', secrets: 'passed', vulnerabilities: 'passed',
    })
    forge = ledger.addAudit(agent, forge.id, {
      stage: 'post-modification', sourceId: source.id, license: 'passed', dependencies: 'passed', secrets: 'passed', vulnerabilities: 'passed',
    })
    forge = ledger.setBlueprint(agent, forge.id, {
      components: ['service'], infrastructure: ['sandbox'], automations: ['health check'], workflows: ['build'],
      metrics: ['pass rate'], costControls: ['bounded retries'], qualityTargets: ['functional'],
    })
    forge = ledger.addDeliverable(agent, forge.id, { name: 'service', kind: 'software', artifactRef: 'artifact:service' })
    const deliverable = forge.deliverables[0]
    if (deliverable === undefined) throw new Error('expected a deliverable')
    forge = ledger.markDeliverable(agent, forge.id, deliverable.id, 'verified', ['test:service'])
    forge = ledger.advance(agent, forge.id, 'verifying')
    forge = ledger.judge(agent, forge.id, {
      verdict: 'blocked', summary: 'External judge unavailable.', findings: ['judge provider'], requiredChanges: [], reviewedAt: Date.now(),
    })
    expect(forge.phase).toBe('blocked')
    expect(forge.goalRef).toEqual({ id: GoalId('goal-origin'), revision: 4 })
    expect(ledger.advance(agent, forge.id, 'verifying').phase).toBe('verifying')
  })
})
