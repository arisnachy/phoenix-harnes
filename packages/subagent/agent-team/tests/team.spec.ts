import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { latestModelSelectionPreference, persistModelSelectionPreference } from '@phoenix-ai/dsh-agent'
import AgentLoop from '@phoenix-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@phoenix-ai/dsh-agent-loop-testkit'
import { defineTool } from '@phoenix-ai/dsh-tools'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
import { SessionId, type Session } from '@phoenix-ai/dsh-session'
import SessionProjections from '@phoenix-ai/dsh-session-projection'
import JsonlSessionPersistence from '@phoenix-ai/dsh-session-persistence-jsonl'
import SubagentService from '@phoenix-ai/dsh-subagent'
import * as SubagentFork from '@phoenix-ai/dsh-subagent-fork-in-process'
import * as TeamTools from '../../tool-agent-team/src/index.ts'
import * as SubagentSpawn from '@phoenix-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService, { foldTeam, TeamError, TeamId, TeamMessageId, TeamTaskId } from '../src/index.ts'
import { teamExecutionProof } from '../src/execution-evidence.ts'
import { TeamRuntimeLifecycle } from '../src/lifecycle.ts'
import type { TeamMemberSnapshot, TeamMessageSnapshot, TeamTaskSnapshot } from '../src/index.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Detached durable Team read: the service exposes views, so assertions fold the Lead log. */
function durable(agent: Agent): {
  members: TeamMemberSnapshot[]
  tasks: TeamTaskSnapshot[]
  pendingMessages: TeamMessageSnapshot[]
} {
  const state = foldTeam(agent.id, agent.session.events)
  return {
    members: [...state.members.values()],
    tasks: [...state.tasks.values()],
    pendingMessages: [...state.messages.values()].filter(message => !state.delivered.has(message.id)),
  }
}

async function setup(
  script: ConstructorParameters<typeof MockAdapter>[0],
  config: ConstructorParameters<typeof TeamService>[1] = {},
  projections = false,
) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(AgentLoop, { agents: [] })
  if (projections) await ctx.plugin(SessionProjections)
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  const teamFiber = await ctx.plugin(TeamService, config)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = ctx.agentLoop.create(SessionId('lead'), { provider: 'mock', model: 'mock' })
  return { ctx, lead, adapter, storageRoot, teamFiber }
}

function content(text: string) {
  return [{ type: 'text' as const, text }]
}

interface TeamServiceInternals {
  readonly roster: {
    readonly inFlightCreations: Set<Promise<unknown>>
    checkpointInitialPrompt(childId: SessionId, messageId: string, signal: AbortSignal): Promise<void>
    reconcileProvisioning(root: Agent, signal: AbortSignal): Promise<void>
    liveChildrenByRoot(): Map<Agent, SessionId[]>
    memberView(member: TeamMemberSnapshot & { readonly phase: 'active' }): {
      readonly usage?: { readonly inputTokens: number; readonly outputTokens: number }
    }
  }
  readonly mailbox: {
    tryDispatch(root: Agent, message: TeamMessageSnapshot, signal: AbortSignal): Promise<boolean>
    serializeDispatch(message: TeamMessageSnapshot, operation: () => Promise<boolean>): Promise<boolean>
    markDelivered(root: Agent, messageId: ReturnType<typeof TeamMessageId>, targetId: SessionId): Promise<void>
  }
  readonly journal: {
    state(root: Agent): unknown
  }
  disposeRuntime(): Promise<void>
  recoverFor(agent: Agent): Promise<void>
  scheduleRecovery(agent: Agent): void
}

/** White-box access follows the runtime owners so coverage does not widen the service API. */
function teamInternals(ctx: Context): TeamServiceInternals {
  return ctx.agentTeams as unknown as TeamServiceInternals
}

function spawn(
  ctx: Context,
  lead: Agent,
  name: string,
  options: { context?: 'fresh' | 'fork'; provider?: string } = {},
) {
  const context = options.context ?? 'fresh'
  return ctx.agentTeams.spawnTeammate(lead, {
    name,
    description: `${name} responsibility`,
    prompt: content(`${name} initial`),
    context,
    provider: options.provider ?? (context === 'fork' ? 'fork' : 'spawn'),
    signal: SIGNAL,
  })
}

async function waitNoAgent(ctx: Context, id: SessionId): Promise<void> {
  await vi.waitFor(() => { expect(ctx.agents.get(id)).toBeUndefined() }, { timeout: 5_000 })
}

async function waitRunning(ctx: Context, id: SessionId): Promise<Agent> {
  return vi.waitFor(() => {
    const agent = ctx.agents.get(id)
    expect(agent?.status).toBe('running')
    return agent!
  }, { timeout: 5_000 })
}

describe('Team identity and provisioning', () => {
  it.each([false, true])('refreshes a reused Team worker route without changing an active request (live=%s)', async (live) => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const { ctx, lead, adapter } = await setup(live
      ? [toolCallResponse('held-work', 'held_work', {}), textResponse('first finished'), textResponse('followup finished')]
      : [textResponse('first finished'), textResponse('followup finished')])
    ctx.llm.registerAdapter(['other'], adapter)
    ctx.tools.register(defineTool({ name: 'held_work', description: 'Hold a real action', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
      async execute(_args, execution) {
        entered.resolve(undefined)
        await release.promise
        expect(execution.signal.aborted).toBe(false)
        return {}
      },
    }))
    const started = await spawn(ctx, lead, 'route-worker')
    if (live) await entered.promise
    else await waitNoAgent(ctx, started.member.id)
    const initial = adapter.requests[0]
    lead.options.provider = 'other'
    lead.options.model = 'other-model'
    persistModelSelectionPreference(lead.session, { provider: 'other', model: 'other-model' }, 'explicit')
    expect((await ctx.agentTeams.sendMessage(lead, {
      target: 'route-worker', content: content('continue on the selected route'), delivery: 'wakeup', signal: SIGNAL,
    })).status).toBe('accepted')
    expect(initial?.provider).toBe('mock')
    if (live) {
      expect(ctx.agents.get(started.member.id)?.options.provider).toBe('other')
      release.resolve(undefined)
    }
    await waitNoAgent(ctx, started.member.id)
    const requests = adapter.requests.filter(request => request.sessionId === started.member.id)
    expect(requests.at(-1)?.provider).toBe('other')
    expect(requests.at(-1)?.model).toBe('other-model')
    const saved = await ctx.sessionPersistence.inspect(started.member.id)
    expect(latestModelSelectionPreference(saved)).toEqual({
      selection: { provider: 'other', model: 'other-model' }, source: 'default',
    })
  })

  it('rejects deployment limits that are not positive safe integers', async () => {
    const fields = [
      'maxMembers',
      'maxTasks',
      'maxPendingMessagesPerMember',
      'maxMessageBytes',
      'disposalTimeoutMs',
    ] as const
    for (const field of fields) {
      for (const value of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        await expect(setup([], { [field]: value })).rejects.toThrow()
      }
    }
  })

  it('supports direct-constructor defaults and recovers roots that already exist', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-direct-'))
    roots.push(storageRoot)
    await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentService)
    const lead = ctx.agentLoop.create(SessionId('preexisting-lead'), {})
    const service = new TeamService(ctx)

    expect(service.listMembers(lead)).toEqual([expect.objectContaining({
      name: 'lead',
      status: 'idle',
      diagnostics: [],
    })])
    const provisioning = {
      id: SessionId('preexisting-child'),
      name: 'preexisting-worker',
      description: 'preexisting responsibility',
      provider: 'spawn',
      context: 'fresh' as const,
      phase: 'provisioning' as const,
    }
    lead.session.append('team/member', {
      version: 1,
      teamId: TeamId(lead.id),
      member: provisioning,
    })
    expect(service.listMembers(lead)[1]).toEqual(expect.objectContaining({
      name: 'preexisting-worker',
      status: 'provisioning',
      diagnostics: [],
    }))
    expect(service.listMembers(lead)[1]).not.toHaveProperty('model')
    await Promise.resolve()
  })

  it('creates fresh and fork teammates with immutable names while completed teammates release capacity', async () => {
    const { ctx, lead } = await setup([
      textResponse('lead answer'),
      textResponse('fork answer'),
      textResponse('fresh answer'),
      textResponse('third answer'),
    ], { maxMembers: 2 })
    lead.followup(createUserMessage({ content: content('lead turn'), source: { kind: 'user' } }))
    await lead.whenIdle()

    const forked = await spawn(ctx, lead, 'fork-worker', { context: 'fork' })
    await waitNoAgent(ctx, forked.member.id)
    const fresh = await spawn(ctx, lead, 'fresh-worker')
    await waitNoAgent(ctx, fresh.member.id)
    const third = await spawn(ctx, lead, 'third-worker')
    await waitNoAgent(ctx, third.member.id)

    expect((await ctx.sessionPersistence.inspect(forked.member.id)).meta.seedLength).toBeGreaterThan(0)
    expect((await ctx.sessionPersistence.inspect(fresh.member.id)).meta.seedLength ?? 0).toBe(0)
    expect(ctx.agentTeams.listMembers(lead).map(row => [row.name, row.context, row.status])).toEqual([
      ['lead', undefined, 'idle'],
      ['fork-worker', 'fork', 'inactive'],
      ['fresh-worker', 'fresh', 'inactive'],
      ['third-worker', 'fresh', 'inactive'],
    ])
    await expect(spawn(ctx, lead, 'fresh-worker')).rejects.toMatchObject({ code: 'TEAM_MEMBER_NAME_TAKEN' })
  })

  it('enforces maxMembers as a concurrent ceiling rather than a lifetime session budget', async () => {
    const { ctx, lead } = await setup(['hang', 'hang', 'hang'], { maxMembers: 2 })
    const first = await spawn(ctx, lead, 'first-worker')
    const second = await spawn(ctx, lead, 'second-worker')
    await waitRunning(ctx, first.member.id)
    await waitRunning(ctx, second.member.id)

    await expect(spawn(ctx, lead, 'third-worker')).rejects.toMatchObject({ code: 'TEAM_MEMBER_LIMIT' })

    ctx.agentTeams.interrupt(lead, 'first-worker')
    await waitNoAgent(ctx, first.member.id)
    const replacement = await spawn(ctx, lead, 'third-worker')
    expect(replacement.member.name).toBe('third-worker')
    ctx.agentTeams.interrupt(lead, 'second-worker')
    ctx.agentTeams.interrupt(lead, 'third-worker')
    await waitNoAgent(ctx, second.member.id)
    await waitNoAgent(ctx, replacement.member.id)
  })

  it('flushes the accepted child prompt before committing the active roster edge', async () => {
    const { ctx, lead } = await setup([textResponse('checkpointed child answer')])
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    const order: string[] = []
    vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      if (session.id === lead.id && durable(lead).members[0]?.phase === 'active') {
        order.push('lead-active')
      } else if (session.id !== lead.id) {
        order.push('child')
      }
      return flush(session)
    })

    const started = await spawn(ctx, lead, 'checkpoint-worker')
    expect(order.indexOf('child')).toBeGreaterThanOrEqual(0)
    expect(order.indexOf('child')).toBeLessThan(order.indexOf('lead-active'))
    await waitNoAgent(ctx, started.member.id)
  })

  it('checkpoints live and detached inbox receipts and aborts an unresolved checkpoint', async () => {
    const { ctx, lead } = await setup([])
    const internal = teamInternals(ctx).roster
    let liveSession: Session | undefined
    const liveFiber = await ctx.plugin(Object.assign(function checkpointFixture(childCtx: Context) {
      liveSession = childCtx.sessions.create(SessionId('checkpoint-child'))
    }, { inject: ['sessions'] }))
    if (liveSession === undefined) throw new Error('checkpoint fixture did not create its Session')
    const initial = createUserMessage({ content: content('checkpoint me'), source: { kind: 'user' } })
    const checkpoint = internal.checkpointInitialPrompt(liveSession.id, initial.id, SIGNAL)
    await Promise.resolve()
    lead.inject(createUserMessage({ content: content('unrelated progress'), source: { kind: 'user' } }))
    const unrelatedFiber = await ctx.plugin(Object.assign(function unrelatedCheckpointFixture(childCtx: Context) {
      childCtx.sessions.create(SessionId('unrelated-checkpoint-child'))
    }, { inject: ['sessions'] }))
    await unrelatedFiber.dispose()
    liveSession.append('agent/inbox/spliced', {
      target: 'next-turn', start: 0, inserted: [initial],
    })
    await checkpoint
    await liveFiber.dispose()

    await expect(internal.checkpointInitialPrompt(liveSession.id, initial.id, SIGNAL)).resolves.toBeUndefined()
    const missing = createUserMessage({ content: content('missing'), source: { kind: 'user' } })
    await expect(internal.checkpointInitialPrompt(liveSession.id, missing.id, SIGNAL))
      .rejects.toMatchObject({ code: 'TEAM_PROVISIONING_CONFLICT' })

    let disposedSession: Session | undefined
    const disposedFiber = await ctx.plugin(Object.assign(function disposedCheckpointFixture(childCtx: Context) {
      disposedSession = childCtx.sessions.create(SessionId('disposed-checkpoint-child'))
    }, { inject: ['sessions'] }))
    if (disposedSession === undefined) throw new Error('disposed checkpoint fixture did not create its Session')
    const disposed = internal.checkpointInitialPrompt(disposedSession.id, missing.id, SIGNAL)
    const disposedResult = expect(disposed).rejects.toThrow('not found')
    await Promise.resolve()
    await disposedFiber.dispose()
    await disposedResult

    let abortedSession: Session | undefined
    const abortedFiber = await ctx.plugin(Object.assign(function abortedCheckpointFixture(childCtx: Context) {
      abortedSession = childCtx.sessions.create(SessionId('aborted-checkpoint-child'))
    }, { inject: ['sessions'] }))
    if (abortedSession === undefined) throw new Error('aborted checkpoint fixture did not create its Session')
    const controller = new AbortController()
    const aborted = internal.checkpointInitialPrompt(abortedSession.id, missing.id, controller.signal)
    await Promise.resolve()
    controller.abort({ kind: 'test' })
    await expect(aborted).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })

    const errorController = new AbortController()
    const errorAborted = internal.checkpointInitialPrompt(abortedSession.id, missing.id, errorController.signal)
    const errorResult = expect(errorAborted).rejects.toThrow('checkpoint stopped')
    await Promise.resolve()
    errorController.abort(new Error('checkpoint stopped'))
    await errorResult
    await abortedFiber.dispose()
  })

  it('drains an accepted child when its initial durability checkpoint fails', async () => {
    const { ctx, lead } = await setup(['hang'])
    vi.spyOn(teamInternals(ctx).roster, 'checkpointInitialPrompt')
      .mockRejectedValueOnce(new Error('checkpoint failed'))

    await expect(spawn(ctx, lead, 'checkpoint-failure')).rejects.toThrow('checkpoint failed')
    const member = durable(lead).members[0]
    expect(member).toMatchObject({ phase: 'failed', error: 'checkpoint failed' })
    if (member !== undefined) await waitNoAgent(ctx, member.id)
  })

  it('retains failed provisioning evidence without occupying a creation slot', async () => {
    const { ctx, lead } = await setup(['hang'], { maxMembers: 1 })
    await expect(spawn(ctx, lead, 'failed-worker', { provider: 'missing' })).rejects.toThrow()

    expect(ctx.agentTeams.listMembers(lead)[1]).toMatchObject({
      name: 'failed-worker',
      status: 'failed',
      provider: 'missing',
    })
    await expect(spawn(ctx, lead, 'failed-worker')).rejects.toMatchObject({ code: 'TEAM_MEMBER_NAME_TAKEN' })
    const actual = await spawn(ctx, lead, 'other-worker')
    expect(actual.member.name).toBe('other-worker')
    expect(ctx.agents.get(actual.member.id)).toBeDefined()
    await expect(spawn(ctx, lead, 'third-worker')).rejects.toMatchObject({ code: 'TEAM_MEMBER_LIMIT' })
  })

  it('records non-Error provider failures and contains a reversed provisioning settlement race', async () => {
    const first = await setup([])
    vi.spyOn(first.ctx.subagents, 'startContinuable').mockRejectedValueOnce('string provider failure')
    await expect(spawn(first.ctx, first.lead, 'string-failure')).rejects.toBe('string provider failure')
    expect(first.ctx.agentTeams.listMembers(first.lead)[1]).toMatchObject({
      status: 'failed',
      diagnostics: ['string provider failure'],
    })
    await expect(first.ctx.agentTeams.sendMessage(first.lead, {
      target: 'string-failure', content: content('cannot deliver'), delivery: 'quiet', signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })

    const second = await setup([])
    vi.spyOn(second.ctx.subagents, 'startContinuable').mockImplementationOnce(async () => {
      const provisioning = durable(second.lead).members[0]
      if (provisioning === undefined) throw new Error('missing provisioning edge')
      second.lead.session.append('team/member', {
        version: 1,
        teamId: TeamId(second.lead.id),
        member: { ...provisioning, phase: 'active' },
      })
      await second.ctx.sessions.flush(second.lead.session)
      throw new Error('creator failed after recovery settled active')
    })
    await expect(spawn(second.ctx, second.lead, 'reverse-race')).rejects.toBeInstanceOf(AggregateError)
    expect(durable(second.lead).members[0]?.phase).toBe('active')
  })

  it('cleans up a child when recovery settles its provisioning record first', async () => {
    const { ctx, lead } = await setup(['hang'])
    const start = ctx.subagents.startContinuable.bind(ctx.subagents)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let childId: SessionId | undefined
    vi.spyOn(ctx.subagents, 'startContinuable').mockImplementation(async (spec) => {
      childId = spec.childId
      entered.resolve(undefined)
      await release.promise
      return start(spec)
    })

    const spawning = spawn(ctx, lead, 'racing-worker')
    const rejected = expect(spawning).rejects.toMatchObject({ code: 'TEAM_PROVISIONING_CONFLICT' })
    await entered.promise
    await teamInternals(ctx).roster.reconcileProvisioning(lead, SIGNAL)
    expect(durable(lead).members[0]?.phase).toBe('failed')

    release.resolve(undefined)
    await rejected
    if (childId === undefined) throw new Error('reserved child id was not observed')
    await waitNoAgent(ctx, childId)
  })

  it('handles a continuation that settles before the active roster view or conflict cleanup lookup', async () => {
    const first = await setup([])
    vi.spyOn(teamInternals(first.ctx).roster, 'checkpointInitialPrompt').mockResolvedValueOnce()
    vi.spyOn(first.ctx.subagents, 'startContinuable').mockImplementationOnce(async spec => ({
      childId: spec.childId!,
      messageId: createUserMessage({ content: content('accepted'), source: { kind: 'user' } }).id,
    }))
    const inactive = await spawn(first.ctx, first.lead, 'instant-worker')
    expect(inactive.member).toMatchObject({ status: 'inactive', diagnostics: [] })
    expect(inactive.member).not.toHaveProperty('model')

    const second = await setup([])
    vi.spyOn(teamInternals(second.ctx).roster, 'checkpointInitialPrompt').mockResolvedValueOnce()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(second.ctx.subagents, 'startContinuable').mockImplementationOnce(async (spec) => {
      entered.resolve(undefined)
      await release.promise
      return {
        childId: spec.childId!,
        messageId: createUserMessage({ content: content('accepted'), source: { kind: 'user' } }).id,
      }
    })
    const spawning = spawn(second.ctx, second.lead, 'instant-conflict')
    const rejected = expect(spawning).rejects.toMatchObject({ code: 'TEAM_PROVISIONING_CONFLICT' })
    await entered.promise
    await teamInternals(second.ctx).roster.reconcileProvisioning(second.lead, SIGNAL)
    release.resolve(undefined)
    await rejected
  })

  it('validates names and permits only the Lead to create or interrupt teammates', async () => {
    const { ctx, lead } = await setup(['hang'])
    for (const name of ['Lead', 'lead', '-bad', 'bad-', 'bad_name', 'x'.repeat(65)]) {
      await expect(spawn(ctx, lead, name)).rejects.toMatchObject({ code: 'TEAM_INVALID_MEMBER_NAME' })
    }
    const started = await spawn(ctx, lead, 'worker')
    const worker = await waitRunning(ctx, started.member.id)
    await expect(spawn(ctx, worker, 'nested')).rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
    expect(() => ctx.agentTeams.interrupt(worker, 'worker')).toThrow(expect.objectContaining({ code: 'TEAM_LEAD_REQUIRED' }))
    expect(ctx.agentTeams.interrupt(lead, 'worker')).toEqual({ previousStatus: 'running' })
    await waitNoAgent(ctx, worker.id)
    expect(ctx.agentTeams.interrupt(lead, 'worker')).toEqual({ previousStatus: 'inactive' })
    expect(() => ctx.agentTeams.interrupt(lead, 'lead')).toThrow(expect.objectContaining({ code: 'TEAM_INVALID_TARGET' }))
  })

  it('validates teammate text fields and pre-provisioning cancellation', async () => {
    const { ctx, lead } = await setup([])
    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'empty-description',
      description: ' ',
      prompt: content('unused'),
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'empty-provider',
      description: 'valid description',
      prompt: content('unused'),
      context: 'fresh',
      provider: ' ',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const controller = new AbortController()
    controller.abort(new TeamError('cancelled before provisioning', 'TEST_CANCELLED'))
    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'cancelled-worker',
      description: 'never provisioned',
      prompt: content('unused'),
      context: 'fresh',
      provider: 'spawn',
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'TEST_CANCELLED' })
    expect(durable(lead).members).toEqual([])
  })

  it('treats an ordinary fork as a new Root Team and filters inherited Team state', async () => {
    const { ctx, lead } = await setup([])
    await ctx.agentTeams.createTask(lead, { subject: 'parent task', description: 'belongs to parent' })
    const handle = await ctx.agents.create({
      sessionId: SessionId('ordinary-fork'),
      seed: lead.session.events,
      meta: { parentSession: lead.id, seedLength: lead.session.seq },
      agentOptions: { provider: 'mock', model: 'mock' },
    })

    expect(ctx.agentTeams.membership(handle.agent)).toMatchObject({
      id: TeamId(handle.agent.id),
      role: 'lead',
      name: 'lead',
    })
    expect(durable(handle.agent)).toMatchObject({ members: [], tasks: [], pendingMessages: [] })
    await handle.dispose()
  })

  it('rejects stale Agent identities and non-Team subagent children', async () => {
    const { ctx, lead } = await setup([textResponse('done')])
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'ordinary worker',
      request: { prompt: content('ordinary'), parent: lead },
      signal: SIGNAL,
    })
    const live = ctx.agents.get(started.childId)
    if (live !== undefined) expect(ctx.agentTeams.tryMembership(live)).toBeUndefined()
    await waitNoAgent(ctx, started.childId)
    expect(() => ctx.agentTeams.membership(lead)).not.toThrow()

    const impostor = { ...lead } as Agent
    expect(ctx.agentTeams.tryMembership(impostor)).toBeUndefined()
    expect(() => ctx.agentTeams.membership(impostor)).toThrow(expect.objectContaining({ code: 'TEAM_NOT_MEMBER' }))

    const orphanRoot = await ctx.agents.create({
      sessionId: SessionId('orphan-ordinary-root'),
      meta: { parentSession: SessionId('absent-parent') },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(ctx.agentTeams.membership(orphanRoot.agent)).toMatchObject({ role: 'lead', name: 'lead' })
    await orphanRoot.dispose()
  })

  it('does not reinterpret an orphaned provider child or malformed parent stream as a Team root', async () => {
    const first = await setup([textResponse('ordinary child done')])
    const parent = await first.ctx.agents.create({
      sessionId: SessionId('temporary-parent'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const started = await first.ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'ordinary child',
      request: { prompt: content('finish'), parent: parent.agent },
      signal: SIGNAL,
    })
    await waitNoAgent(first.ctx, started.childId)
    await parent.dispose()
    const orphan = await first.ctx.agents.resume({
      resumeSessionId: started.childId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(first.ctx.agentTeams.tryMembership(orphan.agent)).toBeUndefined()
    expect(teamInternals(first.ctx).roster.liveChildrenByRoot()).toEqual(new Map())
    await orphan.dispose()

    const second = await setup([])
    const child = await second.ctx.agents.create({
      sessionId: SessionId('malformed-parent-child'),
      meta: { parentSession: second.lead.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const journal = teamInternals(second.ctx).journal
    const state = journal.state.bind(journal)
    journal.state = () => { throw new Error('malformed Team stream') }
    expect(second.ctx.agentTeams.tryMembership(child.agent)).toBeUndefined()
    journal.state = state
    await child.dispose()
  })
})

describe('Team shared task DAG', () => {
  it('fails loudly when the durable numeric task id space is exhausted', async () => {
    const { ctx, lead } = await setup([])
    const id = TeamTaskId(`task-${Number.MAX_SAFE_INTEGER}`)
    lead.session.append('team/task', {
      version: 1,
      teamId: TeamId(lead.id),
      task: {
        id,
        revision: 1,
        subject: 'last numeric task',
        description: 'occupies the final safe numeric task id',
        status: 'pending',
        blockedBy: [],
        writeScopes: [],
      },
    })
    await ctx.sessions.flush(lead.session)

    await expect(ctx.agentTeams.createTask(lead, {
      subject: 'cannot allocate',
      description: 'no safe numeric task id remains',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_LIMIT' })
  })

  it('bounds non-deleted tasks while retaining deleted task ids as tombstones', async () => {
    const { ctx, lead } = await setup([], { maxTasks: 1 })
    const first = await ctx.agentTeams.createTask(lead, { subject: 'first', description: 'first task' })
    await expect(ctx.agentTeams.createTask(lead, { subject: 'overflow', description: 'overflow task' }))
      .rejects.toMatchObject({ code: 'TEAM_TASK_LIMIT' })

    const deleted = await ctx.agentTeams.updateTask(lead, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'delete',
    })
    const second = await ctx.agentTeams.createTask(lead, { subject: 'second', description: 'second task' })
    expect(deleted.status).toBe('deleted')
    expect(second.id).toBe(TeamTaskId('task-2'))
    expect(ctx.agentTeams.getTask(lead, first.id).status).toBe('deleted')
    expect(ctx.agentTeams.listTasks(lead).map(task => task.id)).toEqual([second.id])
  })

  it('enforces CAS, ownership, dependencies, transitions, and write-scope warnings', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    const firstMember = await spawn(ctx, lead, 'alpha')
    const alpha = await waitRunning(ctx, firstMember.member.id)
    const secondMember = await spawn(ctx, lead, 'beta')
    const beta = await waitRunning(ctx, secondMember.member.id)

    const first = await ctx.agentTeams.createTask(alpha, {
      subject: 'first',
      description: 'first task',
      writeScopes: ['src', './src/', 'src'],
    })
    const second = await ctx.agentTeams.createTask(beta, {
      subject: 'second',
      description: 'second task',
      blockedBy: [first.id],
      writeScopes: ['src/feature'],
    })
    expect(first.writeScopes).toEqual(['src'])
    await expect(ctx.agentTeams.updateTask(beta, {
      taskId: second.id,
      expectedRevision: second.revision,
      action: 'claim',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_BLOCKED' })

    const claimed = await ctx.agentTeams.updateTask(alpha, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'claim',
    })
    await expect(ctx.agentTeams.updateTask(beta, {
      taskId: first.id,
      expectedRevision: claimed.revision,
      action: 'claim',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_ALREADY_CLAIMED' })
    expect(ctx.agentTeams.getTask(beta, second.id)).toMatchObject({
      ready: false,
      writeScopeWarnings: [`write scopes overlap with ${first.id}`],
    })
    await expect(ctx.agentTeams.updateTask(beta, {
      taskId: first.id,
      expectedRevision: claimed.revision,
      action: 'edit',
      subject: 'stolen',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_UNAUTHORIZED' })
    await expect(ctx.agentTeams.updateTask(alpha, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'complete',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_STALE_REVISION' })

    const completed = await ctx.agentTeams.updateTask(alpha, {
      taskId: first.id,
      expectedRevision: claimed.revision,
      action: 'complete',
    })
    expect(completed.status).toBe('completed')
    expect(ctx.agentTeams.getTask(beta, second.id).ready).toBe(true)
    const secondClaim = await ctx.agentTeams.updateTask(beta, {
      taskId: second.id,
      expectedRevision: second.revision,
      action: 'claim',
    })
    const released = await ctx.agentTeams.updateTask(beta, {
      taskId: second.id,
      expectedRevision: secondClaim.revision,
      action: 'release',
    })
    expect(released).toMatchObject({ status: 'pending', ready: true })
    expect('ownerId' in released).toBe(false)

    ctx.agentTeams.interrupt(lead, 'alpha')
    ctx.agentTeams.interrupt(lead, 'beta')
    await Promise.all([waitNoAgent(ctx, alpha.id), waitNoAgent(ctx, beta.id)])
  })

  it('rejects malformed scopes and every invalid dependency relation', async () => {
    const { ctx, lead } = await setup([])
    const first = await ctx.agentTeams.createTask(lead, { subject: 'one', description: 'one' })
    const second = await ctx.agentTeams.createTask(lead, {
      subject: 'two', description: 'two', blockedBy: [first.id],
    })
    await expect(ctx.agentTeams.createTask(lead, {
      subject: 'bad', description: 'bad', blockedBy: [TeamTaskId('missing')],
    })).rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'set_dependencies',
      blockedBy: [second.id],
    })).rejects.toMatchObject({ code: 'TEAM_TASK_DEPENDENCY_CYCLE' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'set_dependencies',
      blockedBy: [first.id],
    })).rejects.toMatchObject({ code: 'TEAM_TASK_DEPENDENCY_CYCLE' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: first.id,
      expectedRevision: first.revision,
      action: 'set_dependencies',
      blockedBy: [second.id, second.id],
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    for (const scope of ['', '.', '..', '/root', 'C:\\root', 'C:root', 'a//b', 'a/../b']) {
      await expect(ctx.agentTeams.createTask(lead, {
        subject: 'scope', description: 'scope', writeScopes: [scope],
      })).rejects.toMatchObject({ code: 'TEAM_INVALID_WRITE_SCOPE' })
    }
  })

  it('rejects incomplete mutations, invalid transitions, and deletion of a live blocker', async () => {
    const { ctx, lead } = await setup([])
    await expect(ctx.agentTeams.createTask(lead, { subject: ' ', description: 'invalid' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.createTask(lead, { subject: 'invalid', description: '' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.createTask(lead, { subject: 'x'.repeat(201), description: 'too long' }))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    const blocker = await ctx.agentTeams.createTask(lead, { subject: 'blocker', description: 'blocker' })
    await ctx.agentTeams.createTask(lead, {
      subject: 'dependent', description: 'dependent', blockedBy: [blocker.id],
    })
    expect(() => ctx.agentTeams.getTask(lead, TeamTaskId('missing')))
      .toThrow(expect.objectContaining({ code: 'TEAM_TASK_NOT_FOUND' }))
    for (const action of ['release', 'complete', 'reopen'] as const) {
      await expect(ctx.agentTeams.updateTask(lead, {
        taskId: blocker.id,
        expectedRevision: blocker.revision,
        action,
      })).rejects.toMatchObject({ code: 'TEAM_TASK_INVALID_TRANSITION' })
    }
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: blocker.id,
      expectedRevision: blocker.revision,
      action: 'edit',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: blocker.id,
      expectedRevision: blocker.revision,
      action: 'set_dependencies',
    })).rejects.toMatchObject({ code: 'TEAM_INVALID_ARGUMENT' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: blocker.id,
      expectedRevision: blocker.revision,
      action: 'delete',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_HAS_DEPENDENTS' })
  })

  it('supports Lead reassignment, completion, reopen, and deletion permissions', async () => {
    const { ctx, lead } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'owner')
    const owner = await waitRunning(ctx, started.member.id)
    const task = await ctx.agentTeams.createTask(owner, { subject: 'lifecycle', description: 'lifecycle' })
    const assigned = await ctx.agentTeams.updateTask(lead, {
      taskId: task.id,
      expectedRevision: task.revision,
      action: 'reassign',
      owner: 'owner',
    })
    await expect(ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: assigned.revision,
      action: 'reassign',
      owner: 'lead',
    })).rejects.toMatchObject({ code: 'TEAM_LEAD_REQUIRED' })
    const complete = await ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: assigned.revision,
      action: 'complete',
    })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: task.id,
      expectedRevision: complete.revision,
      action: 'reassign',
      owner: 'lead',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_INVALID_TRANSITION' })
    const reopened = await ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: complete.revision,
      action: 'reopen',
    })
    const claimed = await ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: reopened.revision,
      action: 'claim',
    })
    const deleted = await ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: claimed.revision,
      action: 'delete',
    })
    expect(deleted.status).toBe('deleted')
    expect(ctx.agentTeams.listTasks(lead)).toEqual([])
    await expect(ctx.agentTeams.updateTask(owner, {
      taskId: task.id,
      expectedRevision: deleted.revision,
      action: 'edit',
      subject: 'late',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_DELETED' })
    ctx.agentTeams.interrupt(lead, 'owner')
    await waitNoAgent(ctx, owner.id)
  })

  it('covers partial edits, Lead ownership, unassignment, and blocked reassignment', async () => {
    const { ctx, lead } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'editor')
    const editor = await waitRunning(ctx, started.member.id)
    const blocker = await ctx.agentTeams.createTask(lead, { subject: 'blocker', description: 'blocker' })
    const task = await ctx.agentTeams.createTask(lead, {
      subject: 'draft',
      description: 'draft description',
      blockedBy: [blocker.id],
    })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: TeamTaskId('missing-update'), expectedRevision: 1, action: 'delete',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_NOT_FOUND' })
    await expect(ctx.agentTeams.updateTask(lead, {
      taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: 'editor',
    })).rejects.toMatchObject({ code: 'TEAM_TASK_BLOCKED' })

    const leadClaim = await ctx.agentTeams.updateTask(lead, {
      taskId: blocker.id, expectedRevision: blocker.revision, action: 'claim',
    })
    expect(leadClaim.ownerName).toBe('lead')
    const completedBlocker = await ctx.agentTeams.updateTask(lead, {
      taskId: blocker.id, expectedRevision: leadClaim.revision, action: 'complete',
    })
    expect(completedBlocker.status).toBe('completed')
    const assigned = await ctx.agentTeams.updateTask(lead, {
      taskId: task.id, expectedRevision: task.revision, action: 'reassign', owner: 'editor',
    })
    const subject = await ctx.agentTeams.updateTask(editor, {
      taskId: task.id, expectedRevision: assigned.revision, action: 'edit', subject: 'edited subject',
    })
    const description = await ctx.agentTeams.updateTask(editor, {
      taskId: task.id,
      expectedRevision: subject.revision,
      action: 'edit',
      description: 'edited description',
    })
    const scopes = await ctx.agentTeams.updateTask(editor, {
      taskId: task.id,
      expectedRevision: description.revision,
      action: 'edit',
      writeScopes: ['src/nested'],
    })
    expect(scopes).toMatchObject({
      subject: 'edited subject',
      description: 'edited description',
      writeScopes: ['src/nested'],
    })
    const unassigned = await ctx.agentTeams.updateTask(lead, {
      taskId: task.id, expectedRevision: scopes.revision, action: 'reassign', owner: ' ',
    })
    expect(unassigned).toMatchObject({ status: 'pending' })
    expect('ownerId' in unassigned).toBe(false)

    const broad = await ctx.agentTeams.createTask(lead, {
      subject: 'broad scope', description: 'broad scope', writeScopes: ['src'],
    })
    const narrow = await ctx.agentTeams.createTask(lead, {
      subject: 'narrow scope', description: 'narrow scope', writeScopes: ['src/nested'],
    })
    const disjoint = await ctx.agentTeams.createTask(lead, {
      subject: 'disjoint scope', description: 'disjoint scope', writeScopes: ['docs'],
    })
    await ctx.agentTeams.updateTask(lead, {
      taskId: broad.id, expectedRevision: broad.revision, action: 'claim',
    })
    await ctx.agentTeams.updateTask(lead, {
      taskId: narrow.id, expectedRevision: narrow.revision, action: 'claim',
    })
    await ctx.agentTeams.updateTask(lead, {
      taskId: disjoint.id, expectedRevision: disjoint.revision, action: 'claim',
    })
    expect(ctx.agentTeams.getTask(lead, broad.id).writeScopeWarnings)
      .toEqual([`write scopes overlap with ${narrow.id}`])

    ctx.agentTeams.interrupt(lead, 'editor')
    await waitNoAgent(ctx, editor.id)
  })
})

describe('Team mailbox and waiting', () => {
  it('acknowledges waking messages persisted by a busy Lead before model claim', async () => {
    const { ctx, lead, teamFiber } = await setup(['hang', 'hang'], { maxPendingMessagesPerMember: 1 })
    const started = await spawn(ctx, lead, 'lead-reporter')
    const reporter = await waitRunning(ctx, started.member.id)
    lead.followup(createUserMessage({ content: content('keep the Lead busy'), source: { kind: 'user' } }))
    await waitRunning(ctx, lead.id)

    const first = await ctx.agentTeams.sendMessage(reporter, {
      target: 'lead', content: content('first wakeup report'), delivery: 'wakeup', signal: SIGNAL,
    })
    const second = await ctx.agentTeams.sendMessage(reporter, {
      target: 'lead', content: content('second wakeup report'), delivery: 'wakeup', signal: SIGNAL,
    })
    expect([first.status, second.status]).toEqual(['accepted', 'accepted'])
    expect(lead.status).toBe('running')
    expect(durable(lead).pendingMessages).toEqual([])

    const messageIds = new Set([first.messageId, second.messageId])
    const persisted = await ctx.sessionPersistence.inspect(lead.id)
    const receiptOrder = persisted.events.flatMap((event) => {
      if (event.type === 'agent/inbox/spliced' && event.data.inserted.some(message =>
        message.source.kind === 'team-message' && messageIds.has(message.source.messageId))) {
        return ['agent/inbox/spliced']
      }
      if (event.type === 'team/message/delivered' && messageIds.has(event.data.messageId)) {
        return ['team/message/delivered']
      }
      return []
    })
    expect(receiptOrder).toEqual([
      'agent/inbox/spliced',
      'team/message/delivered',
      'agent/inbox/spliced',
      'team/message/delivered',
    ])

    const receiptCount = lead.session.events.filter(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.source.kind === 'team-message'
        && messageIds.has(message.source.messageId))).length
    await teamFiber.dispose()
    await ctx.plugin(TeamService, { maxPendingMessagesPerMember: 1 })
    await vi.waitFor(() => { expect(durable(lead).pendingMessages).toEqual([]) })
    expect(lead.session.events.filter(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.source.kind === 'team-message'
        && messageIds.has(message.source.messageId)))).toHaveLength(receiptCount)

    lead.cancel({ kind: 'parent' })
    await lead.whenIdle()
  })

  it('flushes a live pending receipt before acknowledgement without inserting a duplicate', async () => {
    const { ctx, lead } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'pending-target')
    const target = await waitRunning(ctx, started.member.id)
    const immediate = await ctx.agentTeams.sendMessage(lead, {
      target: 'pending-target',
      content: content('live quiet receipt'),
      delivery: 'quiet',
      signal: SIGNAL,
    })
    expect(immediate.status).toBe('accepted')
    expect(durable(lead).pendingMessages).toEqual([])
    expect(target.inbox.nextStep.some(item => item.source.kind === 'team-message'
      && item.source.messageId === immediate.messageId)).toBe(true)

    const message: TeamMessageSnapshot = {
      id: TeamMessageId('live-pending-message'),
      senderId: lead.id,
      senderName: 'lead',
      targetId: target.id,
      delivery: 'quiet',
      content: content('durable pending receipt'),
    }
    lead.session.append('team/message/queued', {
      version: 1,
      teamId: TeamId(lead.id),
      message,
    })
    await ctx.sessions.flush(lead.session)
    target.inject(createUserMessage({
      content: content('durable pending receipt'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: message.id,
        senderId: lead.id,
        senderName: 'lead',
      },
    }))

    const flush = ctx.sessions.flush.bind(ctx.sessions)
    const flushed: SessionId[] = []
    const flushSpy = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      flushed.push(session.id)
      return flush(session)
    })
    const delivered = await teamInternals(ctx).mailbox.tryDispatch(lead, message, SIGNAL)

    expect(delivered).toBe(true)
    expect(flushed.slice(0, 2)).toEqual([target.id, lead.id])
    expect(target.inbox.nextStep.filter(item => item.source.kind === 'team-message'
      && item.source.messageId === message.id)).toHaveLength(1)
    expect(durable(lead).pendingMessages).toEqual([])

    const disappearing: TeamMessageSnapshot = {
      ...message,
      id: TeamMessageId('disappearing-pending-message'),
      content: content('canceled before checkpoint'),
    }
    lead.session.append('team/message/queued', {
      version: 1,
      teamId: TeamId(lead.id),
      message: disappearing,
    })
    await flush(lead.session)
    const disappearingInput = createUserMessage({
      content: content('canceled before checkpoint'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: disappearing.id,
        senderId: lead.id,
        senderName: 'lead',
      },
    })
    target.inject(disappearingInput)
    flushSpy.mockImplementationOnce(async (session) => {
      target.inbox.remove(disappearingInput.id)
      return flush(session)
    })
    await expect(teamInternals(ctx).mailbox.tryDispatch(lead, disappearing, SIGNAL)).resolves.toBe(false)
    expect(durable(lead).pendingMessages.map(pending => pending.id)).toEqual([disappearing.id])

    ctx.agentTeams.interrupt(lead, 'pending-target')
    target.cancel({ kind: 'parent' })
    await waitNoAgent(ctx, target.id)
  })

  it('acknowledges waking messages accepted by a busy target inbox', async () => {
    const { ctx, lead } = await setup(['hang'], { maxPendingMessagesPerMember: 1 })
    const started = await spawn(ctx, lead, 'busy-target')
    const target = await waitRunning(ctx, started.member.id)
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    const flushed: SessionId[] = []
    vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      flushed.push(session.id)
      return flush(session)
    })

    const first = await ctx.agentTeams.sendMessage(lead, {
      target: 'busy-target', content: content('first waking message'), delivery: 'wakeup', signal: SIGNAL,
    })

    expect(first.status).toBe('accepted')
    expect(flushed).toEqual([lead.id, target.id, lead.id])
    expect(durable(lead).pendingMessages).toEqual([])
    expect(target.inbox.nextTurn.some(message => message.source.kind === 'team-message'
      && message.source.messageId === first.messageId)).toBe(true)

    flushed.length = 0
    const second = await ctx.agentTeams.sendMessage(lead, {
      target: 'busy-target', content: content('second waking message'), delivery: 'wakeup', signal: SIGNAL,
    })

    expect(second.status).toBe('accepted')
    expect(flushed).toEqual([lead.id, target.id, lead.id])
    expect(durable(lead).pendingMessages).toEqual([])
    expect(target.inbox.nextTurn.filter(message => message.source.kind === 'team-message'
      && (message.source.messageId === first.messageId || message.source.messageId === second.messageId)))
      .toHaveLength(2)

    ctx.agentTeams.interrupt(lead, 'busy-target')
    target.cancel({ kind: 'parent' })
    await waitNoAgent(ctx, target.id)
  })

  it('serializes concurrent waking delivery admission for one target', async () => {
    const { ctx, lead } = await setup([textResponse('target initial')])
    const target = await spawn(ctx, lead, 'ordered-target')
    await waitNoAgent(ctx, target.member.id)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const admitted: string[] = []
    vi.spyOn(ctx.subagents, 'followup').mockImplementation(async (_parent, _childId, blocks) => {
      const last = blocks.at(-1)
      const text = last?.type === 'text' ? last.text : ''
      admitted.push(text)
      if (text === 'first waking') {
        entered.resolve(undefined)
        await release.promise
      }
      return createUserMessage({ content: blocks, source: { kind: 'user' } }).id
    })

    const first = ctx.agentTeams.sendMessage(lead, {
      target: 'ordered-target', content: content('first waking'), delivery: 'wakeup', signal: SIGNAL,
    })
    await entered.promise
    let secondSettled = false
    const second = ctx.agentTeams.sendMessage(lead, {
      target: 'ordered-target', content: content('second waking'), delivery: 'wakeup', signal: SIGNAL,
    }).finally(() => { secondSettled = true })
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
    expect(admitted).toEqual(['first waking'])
    expect(secondSettled).toBe(false)

    release.resolve(undefined)
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { status: 'accepted' },
      { status: 'accepted' },
    ])
    expect(admitted).toEqual(['first waking', 'second waking'])
  })

  it('deduplicates live target history and contains inspection and delivery failures', async () => {
    const { ctx, lead } = await setup(['hang', textResponse('inactive target initial')])
    const liveStarted = await spawn(ctx, lead, 'live-target')
    const live = await waitRunning(ctx, liveStarted.member.id)
    const internal = teamInternals(ctx).mailbox
    const message: TeamMessageSnapshot = {
      id: TeamMessageId('live-recorded-message'),
      senderId: lead.id,
      senderName: 'lead',
      targetId: live.id,
      delivery: 'wakeup',
      content: content('already in live history'),
    }
    lead.session.append('team/message/queued', {
      version: 1, teamId: TeamId(lead.id), message,
    })
    await ctx.sessions.flush(lead.session)
    live.session.append('user/message', createUserMessage({
      content: content('different Team message first'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: TeamMessageId('other-message'),
        senderId: lead.id,
        senderName: 'lead',
      },
    }), { surfaceOp: 'append' })
    live.session.append('user/message', createUserMessage({
      content: content('already in live history'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: message.id,
        senderId: lead.id,
        senderName: 'lead',
      },
    }), { surfaceOp: 'append' })
    await expect(internal.tryDispatch(lead, message, SIGNAL)).resolves.toBe(true)
    await internal.markDelivered(lead, message.id, live.id)

    const wrongTarget: TeamMessageSnapshot = {
      ...message,
      id: TeamMessageId('wrong-target-message'),
    }
    lead.session.append('team/message/queued', {
      version: 1, teamId: TeamId(lead.id), message: wrongTarget,
    })
    await ctx.sessions.flush(lead.session)
    await internal.markDelivered(lead, wrongTarget.id, SessionId('wrong-target'))
    await expect(internal.serializeDispatch(wrongTarget, async () => true)).resolves.toBe(true)
    const serialEntered = Promise.withResolvers<undefined>()
    const releaseSerial = Promise.withResolvers<undefined>()
    const serialFirst = internal.serializeDispatch(wrongTarget, async () => {
      serialEntered.resolve(undefined)
      await releaseSerial.promise
      return true
    })
    await serialEntered.promise
    const serialSecond = internal.serializeDispatch({
      ...wrongTarget, id: TeamMessageId('second-serialized-message'),
    }, async () => true)
    releaseSerial.resolve(undefined)
    await expect(Promise.all([serialFirst, serialSecond])).resolves.toEqual([true, true])

    const warnings: string[] = []
    ctx.logger.warn = ((value: unknown) => { warnings.push(String(value)) }) as typeof ctx.logger.warn
    const failedAck = vi.spyOn(ctx.sessions, 'flush').mockRejectedValueOnce(new Error('acknowledgement flush failed'))
    live.session.append('user/message', createUserMessage({
      content: content('acknowledgement failure'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: wrongTarget.id,
        senderId: lead.id,
        senderName: 'lead',
      },
    }), { surfaceOp: 'append' })
    await vi.waitFor(() => {
      expect(warnings.some(warning => warning.includes('acknowledgement flush failed'))).toBe(true)
    })
    failedAck.mockRestore()

    const inactiveStarted = await spawn(ctx, lead, 'inactive-target')
    await waitNoAgent(ctx, inactiveStarted.member.id)
    const inspect = vi.spyOn(ctx.sessionPersistence, 'inspect').mockRejectedValueOnce(new Error('inspect unavailable'))
    const uncertain = await ctx.agentTeams.sendMessage(lead, {
      target: 'inactive-target', content: content('inspection failure'), delivery: 'wakeup', signal: SIGNAL,
    })
    expect(uncertain.status).toBe('queued')
    inspect.mockRestore()

    vi.spyOn(ctx.subagents, 'followup').mockRejectedValueOnce(new Error('delivery unavailable'))
    const failed = await ctx.agentTeams.sendMessage(lead, {
      target: 'inactive-target', content: content('delivery failure'), delivery: 'wakeup', signal: SIGNAL,
    })
    expect(failed.status).toBe('queued')
    expect(warnings.some(warning => warning.includes('inspect unavailable'))).toBe(true)
    expect(warnings.some(warning => warning.includes('delivery unavailable'))).toBe(true)

    ctx.agentTeams.interrupt(lead, 'live-target')
    await waitNoAgent(ctx, live.id)
  })

  it.each(['result', 'blocker', 'review', 'question'] as const)('wakes idle Kira for a %s handoff and supplies a named response decision', async (purpose) => {
    const { ctx, lead, adapter } = await setup(['hang', textResponse('Argo, revisaré la alternativa y te diré cómo seguimos.')])
    const started = await spawn(ctx, lead, 'argo')
    const worker = await waitRunning(ctx, started.member.id)
    const steer = vi.spyOn(lead, 'steer')
    const sent = await ctx.agentTeams.sendMessage(worker, {
      target: 'lead', purpose, content: content('No hay fuentes verificables anteriores al corte.'),
      delivery: 'quiet', signal: SIGNAL,
    })
    expect(sent.status).toBe('accepted')
    await vi.waitFor(() => expect(steer).toHaveBeenCalledTimes(1))
    const input = steer.mock.calls[0]![0]
    expect(input.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
      .toContain('Respond to argo by name')
    expect(input.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
      .toContain('Execute that next action in this turn')
    await vi.waitFor(() => expect(adapter.requests).toHaveLength(2))
    await vi.waitFor(() => expect(lead.session.events.some(event => event.type === 'assistant/message'
      && event.data.message.content.some(block => block.type === 'text'
        && block.text === 'Argo, revisaré la alternativa y te diré cómo seguimos.'))).toBe(true))
    await ctx.agentTeams.sendMessage(worker, {
      target: 'lead', purpose: 'update', content: content('Sigo buscando.'), delivery: 'quiet', signal: SIGNAL,
    })
    expect(steer).toHaveBeenCalledTimes(1)
    ctx.agentTeams.interrupt(lead, 'argo')
    await waitNoAgent(ctx, worker.id)
  })

  it('blocks a late Aegis reviewer after Kira completed the Selenium browser mission', async () => {
    const { ctx, lead } = await setup(['hang'])
    lead.session.append('turn/start', { turn: 1 })
    lead.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    // A second Aegis after the Lead's verified delivery is not a new task.
    await expect(spawn(ctx, lead, 'aegis')).rejects.toMatchObject({ code: 'TEAM_MISSION_CLOSED' })
    expect(durable(lead).members).toHaveLength(0)

    // A new programmatic turn cannot revive closed work; only human input can.
    lead.session.append('turn/start', { turn: 2 })
    await expect(spawn(ctx, lead, 'aegis')).rejects.toMatchObject({ code: 'TEAM_MISSION_CLOSED' })
    lead.session.append('user/message', createUserMessage({
      content: content('Kira, revisa una tarea nueva.'), source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    lead.session.append('turn/start', { turn: 3 })
    const started = await spawn(ctx, lead, 'aegis')
    expect(started.member.name).toBe('aegis')
    ctx.agentTeams.interrupt(lead, 'aegis')
    await waitNoAgent(ctx, started.member.id)
  })

  it('does not wake Kira for a quiet handoff after explicit user cancellation', async () => {
    const { ctx, lead } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'argo')
    const worker = await waitRunning(ctx, started.member.id)
    lead.session.append('turn/start', { turn: 1 })
    lead.session.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })
    const steer = vi.spyOn(lead, 'steer')
    await expect(ctx.agentTeams.sendMessage(worker, {
      target: 'lead', purpose: 'blocker', content: content('No hay fuentes.'), delivery: 'quiet', signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MISSION_CLOSED' })
    expect(steer).not.toHaveBeenCalled()
    ctx.agentTeams.interrupt(lead, 'argo')
    await waitNoAgent(ctx, worker.id)
  })

  it('keeps quiet mail dormant, wakes on follow-up, preserves FIFO, and de-duplicates delivery', async () => {
    const { ctx, lead } = await setup(['hang', textResponse('beta first'), textResponse('beta resumed')])
    const alphaStarted = await spawn(ctx, lead, 'alpha')
    const alpha = await waitRunning(ctx, alphaStarted.member.id)
    const betaStarted = await spawn(ctx, lead, 'beta')
    await waitNoAgent(ctx, betaStarted.member.id)

    const quiet = await ctx.agentTeams.sendMessage(alpha, {
      target: 'beta', content: content('quiet info'), delivery: 'quiet', signal: SIGNAL,
    })
    expect(quiet.status).toBe('queued')
    expect(ctx.agents.get(betaStarted.member.id)).toBeUndefined()
    const waking = await ctx.agentTeams.sendMessage(alpha, {
      target: 'beta', content: content('do another turn'), delivery: 'wakeup', signal: SIGNAL,
    })
    expect(waking.status).toBe('accepted')
    await waitNoAgent(ctx, betaStarted.member.id)
    await vi.waitFor(() => { expect(durable(lead).pendingMessages).toEqual([]) })

    const stored = await ctx.sessionPersistence.inspect(betaStarted.member.id)
    const peerMessages = stored.events.filter(event => event.type === 'user/message'
      && event.data.source.kind === 'team-message')
    expect(peerMessages.map((event) => {
      if (event.type !== 'user/message') return undefined
      const block = event.data.content.at(-1)
      return block?.type === 'text' ? block.text : undefined
    })).toEqual(['quiet info', 'do another turn'])
    expect(peerMessages.map(event => event.type === 'user/message'
      ? event.data.content[0]?.type === 'text' && event.data.content[0].text
      : undefined)).toEqual([
      expect.stringMatching(/^Team message .* from alpha:$/u),
      expect.stringMatching(/^Team message .* from alpha:$/u),
    ])
    expect(peerMessages.map(event => event.type === 'user/message' && event.data.source.kind === 'team-message'
      ? [event.data.source.messageId, event.data.source.senderName]
      : undefined)).toEqual([
      [quiet.messageId, 'alpha'],
      [waking.messageId, 'alpha'],
    ])

    ctx.agentTeams.interrupt(lead, 'alpha')
    await waitNoAgent(ctx, alpha.id)
  })

  it('rejects invalid reactions and exposes live usage so the Lead can supervise cost', async () => {
    const { ctx, lead } = await setup([textResponse('first turn'), 'hang', 'hang'])
    const worker = await spawn(ctx, lead, 'usage-worker')
    await waitNoAgent(ctx, worker.member.id)

    await expect(ctx.agentTeams.reactToMessage(lead, {
      messageId: TeamMessageId('missing'),
      reaction: 'ack',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MESSAGE_NOT_FOUND' })

    const own = await ctx.agentTeams.sendMessage(lead, {
      target: 'usage-worker',
      purpose: 'assignment',
      content: content('wake and continue'),
      delivery: 'wakeup',
      signal: SIGNAL,
    })
    await expect(ctx.agentTeams.reactToMessage(lead, {
      messageId: own.messageId,
      reaction: 'ack',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_SELF_REACTION' })

    const live = await waitRunning(ctx, worker.member.id)
    const peer = await ctx.agentTeams.sendMessage(live, {
      target: 'lead',
      purpose: 'result',
      content: content('evidence'),
      delivery: 'quiet',
      signal: SIGNAL,
    })
    await expect(ctx.agentTeams.reactToMessage(lead, {
      messageId: peer.messageId,
      reaction: 'ack',
      signal: SIGNAL,
    })).resolves.toMatchObject({ reactorName: 'lead', reaction: 'ack' })
    await expect(ctx.agentTeams.reactToMessage(lead, {
      messageId: peer.messageId,
      reaction: 'agree',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_REACTION_EXISTS' })

    const listed = ctx.agentTeams.listMembers(lead).find(item => item.name === 'usage-worker')
    expect(listed?.usage).toMatchObject({ inputTokens: 10, outputTokens: 'first turn'.length })

    const active = foldTeam(lead.id, lead.session.events).members.get(worker.member.id)
    expect(active?.phase).toBe('active')
    const directView = teamInternals(ctx).roster.memberView(active as TeamMemberSnapshot & { phase: 'active' })
    expect(directView.usage).toMatchObject({ inputTokens: 10, outputTokens: 'first turn'.length })

    ctx.agentTeams.interrupt(lead, 'usage-worker')
    await waitNoAgent(ctx, worker.member.id)
    lead.cancel({ kind: 'user' })
    await lead.whenIdle()
  })

  it('enforces message byte and pending-count limits without encouraging retry after enqueue', async () => {
    const { ctx, lead } = await setup([textResponse('idle')], {
      maxMessageBytes: 256,
      maxPendingMessagesPerMember: 1,
    })
    const target = await spawn(ctx, lead, 'target')
    await waitNoAgent(ctx, target.member.id)
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'target', content: content('x'.repeat(300)), delivery: 'quiet', signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MESSAGE_TOO_LARGE' })
    const queued = await ctx.agentTeams.sendMessage(lead, {
      target: 'target', content: content('one'), delivery: 'quiet', signal: SIGNAL,
    })
    expect(queued.status).toBe('queued')
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'target', content: content('two'), delivery: 'quiet', signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MAILBOX_FULL' })
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'lead', content: content('self'), delivery: 'quiet', signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_SELF_MESSAGE' })
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'missing', content: content('unknown target'), delivery: 'quiet', signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_MEMBER_NOT_FOUND' })
    const controller = new AbortController()
    controller.abort(new TeamError('cancelled before queue', 'TEST_CANCELLED'))
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'target', content: content('cancelled'), delivery: 'quiet', signal: controller.signal,
    })).rejects.toMatchObject({ code: 'TEST_CANCELLED' })
  })

  it('interrupts only the current turn and retains an already accepted follow-up', async () => {
    const { ctx, lead } = await setup(['hang', textResponse('after interrupt')])
    const started = await spawn(ctx, lead, 'worker')
    const worker = await waitRunning(ctx, started.member.id)
    const followup = await ctx.agentTeams.sendMessage(lead, {
      target: 'worker', content: content('retained follow-up'), delivery: 'wakeup', signal: SIGNAL,
    })
    expect(followup.status).toBe('accepted')
    expect(ctx.agentTeams.interrupt(lead, 'worker')).toEqual({ previousStatus: 'running' })
    await vi.waitFor(() => { expect(worker.status).toBe('idle') })
    expect(worker.inbox.nextTurn.some(message => message.source.kind === 'team-message'
      && message.source.messageId === followup.messageId)).toBe(true)
    worker.cancel({ kind: 'parent' })
    await waitNoAgent(ctx, worker.id)
  })

  it('waits for one change, supports cancellation, times out, and releases waiters on HMR disposal', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-wait-'))
    roots.push(storageRoot)
    await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentService)
    const fiber = await ctx.plugin(TeamService)
    const service = ctx.agentTeams
    const lead = ctx.agentLoop.create(SessionId('wait-lead'), {})

    await expect(service.waitForChange(lead, 9_999, SIGNAL))
      .rejects.toMatchObject({ code: 'TEAM_INVALID_TIMEOUT' })
    const alreadyAborted = new AbortController()
    alreadyAborted.abort(new TeamError('cancelled before wait', 'TEST_CANCELLED'))
    await expect(service.waitForChange(lead, 10_000, alreadyAborted.signal))
      .rejects.toMatchObject({ code: 'TEST_CANCELLED' })

    const changed = service.waitForChange(lead, 10_000, SIGNAL)
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    const flushEntered = Promise.withResolvers<undefined>()
    const releaseFlush = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
      flushEntered.resolve(undefined)
      await releaseFlush.promise
      return await flush(session)
    })
    let waitSettled = false
    void changed.finally(() => { waitSettled = true })
    const creating = service.createTask(lead, { subject: 'wake', description: 'wake waiter' })
    await flushEntered.promise
    expect(waitSettled).toBe(false)
    releaseFlush.resolve(undefined)
    await creating
    await expect(changed).resolves.toEqual({ timedOut: false })

    const controller = new AbortController()
    const cancelled = service.waitForChange(lead, 10_000, controller.signal)
    controller.abort(new TeamError('cancelled', 'TEST_CANCELLED'))
    await expect(cancelled).rejects.toMatchObject({ code: 'TEST_CANCELLED' })

    const stringAbort = new AbortController()
    const firstWaiter = service.waitForChange(lead, 10_000, stringAbort.signal)
    const secondWaiter = service.waitForChange(lead, 10_000, SIGNAL)
    stringAbort.abort('string cancellation')
    await expect(firstWaiter).rejects.toMatchObject({
      code: 'TEAM_WAIT_ABORTED',
      message: 'wait_agent aborted: string cancellation',
    })
    await service.createTask(lead, { subject: 'second waiter', description: 'second waiter remains registered' })
    await expect(secondWaiter).resolves.toEqual({ timedOut: false })

    const objectAbort = new AbortController()
    const objectCancelled = service.waitForChange(lead, 10_000, objectAbort.signal)
    objectAbort.abort({ kind: 'user' })
    await expect(objectCancelled).rejects.toMatchObject({
      code: 'TEAM_WAIT_ABORTED',
      message: "wait_agent aborted: { kind: 'user' }",
    })

    await service.createTask(lead, { subject: 'already changed', description: 'edge-triggered wait' })
    vi.useFakeTimers()
    const timeout = service.waitForChange(lead, 10_000, SIGNAL)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(timeout).resolves.toEqual({ timedOut: true })
    vi.useRealTimers()

    const disposed = service.waitForChange(lead, 10_000, SIGNAL)
    await fiber.dispose()
    await expect(disposed).resolves.toEqual({ timedOut: false })
    expect(ctx.get('agentTeams')).toBeUndefined()
  })

  it('disposes live teammate Activations and their waits when the Team service unloads', async () => {
    const { ctx, lead, teamFiber } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'dispose-worker')
    await waitRunning(ctx, started.member.id)
    const waiting = ctx.agentTeams.waitForChange(lead, 10_000, SIGNAL)

    await teamFiber.dispose()

    await expect(waiting).resolves.toEqual({ timedOut: false })
    expect(ctx.agents.get(started.member.id)).toBeUndefined()
    expect(ctx.get('agentTeams')).toBeUndefined()
  })

  it('closes creation admission and drains an in-flight spawn before unload completes', async () => {
    const { ctx, lead, teamFiber } = await setup(['hang'])
    const service = ctx.agentTeams
    const start = ctx.subagents.startContinuable.bind(ctx.subagents)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let childId: SessionId | undefined
    vi.spyOn(ctx.subagents, 'startContinuable').mockImplementation(async (spec) => {
      childId = spec.childId
      entered.resolve(undefined)
      await release.promise
      return start(spec)
    })
    const spawning = spawn(ctx, lead, 'disposing-worker')
    const rejected = expect(spawning).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    await entered.promise

    const disposal = teamFiber.dispose()
    await Promise.resolve()
    await expect(service.waitForChange(lead, 3_600_000, SIGNAL)).resolves.toEqual({ timedOut: false })
    await expect(service.spawnTeammate(lead, {
      name: 'late-worker',
      description: 'must not enter after disposal',
      prompt: content('late task'),
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    release.resolve(undefined)

    await rejected
    await disposal
    if (childId !== undefined) expect(ctx.agents.get(childId)).toBeUndefined()
    expect(ctx.get('agentTeams')).toBeUndefined()
  })

  it('retains an in-flight creation cleanup failure during disposal', async () => {
    const { ctx } = await setup([])
    const internal = teamInternals(ctx)
    const cleanupFailure = new Error('creation cleanup failed')
    const rejected = Promise.reject(cleanupFailure)
    void rejected.catch(() => undefined)
    internal.roster.inFlightCreations.add(rejected)

    await expect(internal.disposeRuntime()).rejects.toMatchObject({ errors: [cleanupFailure] })
  })

  it('recognizes wrapped and coded runtime cancellation during disposal settlement', async () => {
    const open = new TeamRuntimeLifecycle(100)
    const ordinaryFailure = new Error('ordinary failure before disposal')
    const openFailures: unknown[] = []
    await open.settle([Promise.reject(ordinaryFailure)], openFailures)
    expect(openFailures).toEqual([ordinaryFailure])

    const lifecycle = new TeamRuntimeLifecycle(100)
    lifecycle.close()
    const failures: unknown[] = []
    await lifecycle.settle([
      Promise.reject(new Error('wrapped cancellation', { cause: lifecycle.reason })),
      Promise.reject(new TeamError('translated cancellation', 'TEAM_DISPOSED')),
    ], failures)
    expect(failures).toEqual([])

    const cyclic = new Error('unrelated cyclic failure')
    cyclic.cause = cyclic
    await lifecycle.settle([Promise.reject(cyclic)], failures)
    expect(failures).toEqual([cyclic])
  })

  it('disposes a live child even after its durable member edge becomes failed', async () => {
    const { ctx, lead } = await setup(['hang'])
    const childId = SessionId('failed-live-child')
    const member = {
      id: childId,
      name: 'failed-live-worker',
      description: 'failed-live-worker responsibility',
      provider: 'spawn',
      context: 'fresh' as const,
      phase: 'provisioning' as const,
    }
    lead.session.append('team/member', {
      version: 1,
      teamId: TeamId(lead.id),
      member,
    })
    await ctx.subagents.startContinuable({
      childId,
      provider: 'spawn',
      label: member.description,
      request: { prompt: content('failed child task'), parent: lead },
      signal: SIGNAL,
    })
    await waitRunning(ctx, childId)
    lead.session.append('team/member', {
      version: 1,
      teamId: TeamId(lead.id),
      member: {
        ...member,
        phase: 'failed',
        error: 'creation cleanup is pending',
      },
    })
    await ctx.sessions.flush(lead.session)
    expect(ctx.agentTeams.listMembers(lead)[1]?.status).toBe('failed')

    const internal = ctx.agentTeams as unknown as { disposeRuntime(): Promise<void> }
    await internal.disposeRuntime()
    expect(ctx.agents.get(childId)).toBeUndefined()
  })

  it('aborts and awaits an admitted cold mailbox dispatch during disposal', async () => {
    const { ctx, lead } = await setup([textResponse('worker done')])
    const started = await spawn(ctx, lead, 'mailbox-worker')
    await waitNoAgent(ctx, started.member.id)
    const entered = Promise.withResolvers<undefined>()
    const aborted = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.subagents, 'followup').mockImplementation(async (_parent, _childId, _content, options) => {
      entered.resolve(undefined)
      return await new Promise<never>((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          aborted.resolve(undefined)
          void release.promise.then(() => {
            const reason: unknown = options.signal.reason
            reject(reason instanceof Error ? reason : new Error(String(reason)))
          })
        }, { once: true })
      })
    })

    const sending = ctx.agentTeams.sendMessage(lead, {
      target: 'mailbox-worker',
      content: content('resume during disposal'),
      delivery: 'wakeup',
      signal: SIGNAL,
    })
    await entered.promise
    const internal = ctx.agentTeams as unknown as { disposeRuntime(): Promise<void> }
    let disposed = false
    const disposal = internal.disposeRuntime().then(() => { disposed = true })
    await aborted.promise
    await Promise.resolve()
    expect(disposed).toBe(false)
    release.resolve(undefined)

    await expect(sending).resolves.toMatchObject({ status: 'queued' })
    await disposal
    expect(disposed).toBe(true)
    expect(ctx.agents.get(started.member.id)).toBeUndefined()
  })

  it('awaits an admitted asynchronous acknowledgement before disposal completes', async () => {
    const { ctx, lead } = await setup([])
    const message: TeamMessageSnapshot = {
      id: TeamMessageId('dispose-ack-message'),
      senderId: SessionId('sender'),
      senderName: 'sender',
      targetId: lead.id,
      delivery: 'wakeup',
      content: content('acknowledge before disposal'),
    }
    lead.session.append('team/message/queued', {
      version: 1,
      teamId: TeamId(lead.id),
      message,
    })
    await ctx.sessions.flush(lead.session)

    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const flush = ctx.sessions.flush.bind(ctx.sessions)
    let blockReceipt = true
    const flushSpy = vi.spyOn(ctx.sessions, 'flush').mockImplementation(async (session) => {
      if (blockReceipt && session === lead.session) {
        blockReceipt = false
        entered.resolve(undefined)
        await release.promise
      }
      return flush(session)
    })
    lead.session.append('user/message', createUserMessage({
      content: content('acknowledge before disposal'),
      source: {
        kind: 'team-message',
        teamId: TeamId(lead.id),
        messageId: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
      },
    }), { surfaceOp: 'append' })

    const internal = ctx.agentTeams as unknown as { disposeRuntime(): Promise<void> }
    let disposed = false
    const disposal = internal.disposeRuntime().then(() => { disposed = true })
    await entered.promise
    await Promise.resolve()
    const disposedBeforeRelease = disposed
    release.resolve(undefined)
    await disposal

    expect(disposedBeforeRelease).toBe(false)
    expect(disposed).toBe(true)
    expect(durable(lead).pendingMessages).toEqual([])
    flushSpy.mockRestore()
  })

  it('bounds Team runtime disposal when a continuation drain never settles', async () => {
    const { ctx, lead, teamFiber } = await setup(['hang'], { disposalTimeoutMs: 25 })
    const started = await spawn(ctx, lead, 'stuck-worker')
    await waitRunning(ctx, started.member.id)
    const drain = vi.spyOn(ctx.subagents, 'drainContinuableChildren')
      .mockImplementation(() => new Promise(() => {}))

    const outcome = await Promise.race([
      teamFiber.dispose().then(() => 'disposed'),
      new Promise<'hung'>((resolve) => { setTimeout(() => { resolve('hung') }, 1_000) }),
    ])
    expect(outcome).toBe('disposed')
    expect(drain).toHaveBeenCalledWith(lead, [started.member.id])
    expect(ctx.get('agentTeams')).toBeUndefined()
  })

  it('bounds disposal while an admitted creation ignores cancellation', async () => {
    const { ctx, lead } = await setup([], { disposalTimeoutMs: 25 })
    const internal = teamInternals(ctx)
    internal.roster.inFlightCreations.add(new Promise(() => {}))

    await expect(internal.disposeRuntime()).rejects.toBeInstanceOf(AggregateError)
    await expect(ctx.agentTeams.spawnTeammate(lead, {
      name: 'after-timeout',
      description: 'admission remains closed',
      prompt: content('must reject'),
      context: 'fresh',
      provider: 'spawn',
      signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    await expect(ctx.agentTeams.sendMessage(lead, {
      target: 'nobody', content: content('must reject'), delivery: 'quiet', signal: SIGNAL,
    })).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    await expect(internal.mailbox.tryDispatch(lead, {
      id: TeamMessageId('post-disposal-message'),
      senderId: lead.id,
      senderName: 'lead',
      targetId: lead.id,
      delivery: 'quiet',
      content: content('must not dispatch'),
    }, SIGNAL)).resolves.toBe(false)
  })

  it('contains recovery callback failures and ignores work scheduled after disposal', async () => {
    const { ctx, lead, teamFiber } = await setup([])
    const warnings: string[] = []
    ctx.logger.warn = ((value: unknown) => { warnings.push(String(value)) }) as typeof ctx.logger.warn
    const internal = teamInternals(ctx)
    internal.recoverFor = async () => { throw new Error('forced recovery failure') }
    internal.scheduleRecovery(lead)
    await Promise.resolve()
    await Promise.resolve()
    expect(warnings.some(warning => warning.includes('forced recovery failure'))).toBe(true)

    lead.session.append('user/message', createUserMessage({
      content: content('orphan Team source'),
      source: {
        kind: 'team-message',
        teamId: TeamId('absent-team'),
        messageId: TeamMessageId('absent-team-message'),
        senderId: SessionId('absent-sender'),
        senderName: 'absent',
      },
    }), { surfaceOp: 'append' })
    await Promise.resolve()

    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    internal.recoverFor = async () => {
      entered.resolve(undefined)
      await release.promise
      throw new Error('failure after disposal')
    }
    internal.scheduleRecovery(lead)
    await entered.promise
    await teamFiber.dispose()
    release.resolve(undefined)
    await Promise.resolve()
    await Promise.resolve()
    internal.scheduleRecovery(lead)
    await Promise.resolve()
  })

  it('reports contained teardown failures without retaining the Team service', async () => {
    const { ctx, lead, teamFiber } = await setup(['hang'])
    const started = await spawn(ctx, lead, 'failing-drain')
    await waitRunning(ctx, started.member.id)
    vi.spyOn(ctx.subagents, 'drainContinuableDescendants').mockRejectedValueOnce(new Error('drain failure'))

    await teamFiber.dispose()
    expect(ctx.get('agentTeams')).toBeUndefined()
  })

  it('reconciles mismatched persisted children and ignores a concurrently settled member', async () => {
    const first = await setup([])
    const liveId = SessionId('live-provisioning-child')
    const live = await first.ctx.agents.create({
      sessionId: liveId,
      meta: { parentSession: first.lead.id },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const provisioning = {
      id: liveId,
      name: 'mismatched-child',
      description: 'mismatched persisted child',
      provider: 'spawn',
      context: 'fresh' as const,
      phase: 'provisioning' as const,
    }
    first.lead.session.append('team/member', {
      version: 1, teamId: TeamId(first.lead.id), member: provisioning,
    })
    const reconcileFirst = teamInternals(first.ctx).roster
    await reconcileFirst.reconcileProvisioning(first.lead, SIGNAL)
    expect(durable(first.lead).members[0]?.phase).toBe('provisioning')
    live.agent.session.append('user/message', createUserMessage({
      content: content('persist mismatched child'), source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await first.ctx.sessions.flush(live.agent.session)
    await live.dispose()
    await reconcileFirst.reconcileProvisioning(first.lead, SIGNAL)
    expect(durable(first.lead).members[0]).toMatchObject({
      phase: 'failed',
      error: 'persisted child Session does not match the provisioned continuation',
    })

    const second = await setup([])
    const childId = SessionId('concurrently-settled-child')
    const member = { ...provisioning, id: childId, name: 'concurrent-child' }
    second.lead.session.append('team/member', {
      version: 1, teamId: TeamId(second.lead.id), member,
    })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(second.ctx.sessionPersistence, 'inspect').mockImplementationOnce(async () => {
      entered.resolve(undefined)
      await release.promise
      throw new Error('late inspection failure')
    })
    const reconcileSecond = teamInternals(second.ctx).roster
    const reconciling = reconcileSecond.reconcileProvisioning(second.lead, SIGNAL)
    await entered.promise
    second.lead.session.append('team/member', {
      version: 1,
      teamId: TeamId(second.lead.id),
      member: { ...member, phase: 'failed', error: 'settled elsewhere' },
    })
    release.resolve(undefined)
    await reconciling
    expect(durable(second.lead).members[0]).toMatchObject({
      phase: 'failed', error: 'settled elsewhere',
    })
  })
})


describe('visible team conversation', () => {
  it('publishes a real worker start before receipts but still hides unsupported completion', async () => {
    const { ctx, lead } = await setup([], {}, true)
    const child = ctx.sessions.create(SessionId('starting-worker'), {
      meta: { parentSession: lead.id, origin: 'subagent' },
    })
    child.append('user/message', createUserMessage({
      source: { kind: 'user' }, content: content('Revisa el archivo y verifica el resultado.'),
    }), { surfaceOp: 'append' })
    for (const message of ['Kira, empiezo por revisar el archivo y sus pruebas.', 'Kira, la API devolvió 403; contrastaré otra ruta.', 'Kira, empiezo por el informe. El archivo ya fue actualizado.']) {
      child.append('assistant/message', {
        turn: 1, step: 1, message: createAssistantMessage({
          source: { provider: 'mock', model: 'mock' }, content: content(message),
        }),
      }, { surfaceOp: 'append' })
    }
    const rows = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages
    expect(rows.map(row => row.text)).toEqual(['Kira, empiezo por revisar el archivo y sus pruebas.', 'Kira, la API devolvió 403; contrastaré otra ruta.'])
    expect(rows[0]?.senderId).toBe(child.id)
  })

  it('hides theatrical operational claims until a real tool receipt exists', async () => {
    const { ctx, lead } = await setup([], {}, true)
    const child = ctx.sessions.create(SessionId('receipt-child'), {
      meta: { parentSession: lead.id, origin: 'subagent' },
    })
    child.append('user/message', createUserMessage({
      source: { kind: 'user' },
      content: content('Envía un correo de prueba por Gmail y confirma el envío.'),
    }), { surfaceOp: 'append' })
    child.append('assistant/message', {
      turn: 1,
      step: 1,
      message: createAssistantMessage({
        source: { provider: 'mock', model: 'mock' },
        content: content('El correo ya fue enviado.'),
      }),
    }, { surfaceOp: 'append' })

    expect((await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages)
      .toEqual([])

    const callId = CallId('gmail-send')
    child.append('tool/call', {
      turn: 1,
      step: 2,
      callId,
      name: 'mcp__Gmail__send_email',
      arguments: '{"to":"example@example.com"}',
    })
    child.append('tool/result', {
      turn: 1,
      step: 2,
      message: createToolResultMessage({
        callId,
        content: content('sent'),
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    child.append('assistant/message', {
      turn: 1,
      step: 3,
      message: createAssistantMessage({
        source: { provider: 'mock', model: 'mock' },
        content: content('Correo de prueba enviado correctamente.'),
      }),
    }, { surfaceOp: 'append' })

    const visible = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages
    const activity = visible.filter(row => row.id.startsWith(child.id + ':activity:'))
    expect(activity).toHaveLength(1)
    expect(activity[0]?.text).toContain('send_email')
    const answers = visible.filter(row => !row.id.startsWith(child.id + ':activity:'))
    expect(answers).toHaveLength(1)
    expect(answers[0]?.text).toContain('Correo de prueba enviado correctamente.')
    expect(answers[0]?.text).toContain('✓ Evidencia ejecutada: send_email')
  })

  it('captures actual generic child text once without injecting the lead or leaking reasoning', async () => {
    const { ctx, lead, adapter } = await setup([], {}, true)
    const child = ctx.sessions.create(SessionId('chat-child'), { meta: { parentSession: lead.id, origin: 'subagent' } })
    child.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({ source: { provider: 'mock', model: 'mock' },
      content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'Verified result.' }],
    }) }, { surfaceOp: 'append' })
    const result = await ctx.agentTeams.chatMessages({ sessionId: lead.id })
    expect(result.messages).toEqual([expect.objectContaining({ senderId: child.id, text: 'Verified result.' })])
    expect(JSON.stringify(result)).not.toContain('private reasoning')
    expect(lead.session.deriveMessages()).toEqual([])
    expect(adapter.requests).toHaveLength(0)
    expect((await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages).toHaveLength(1)
  })

  it('persists Unicode reactions idempotently and removes only the selected emoji without waking a model', async () => {
    const { ctx, lead, adapter } = await setup([], {}, true)
    const message = createUserMessage({ content: content('Please check this'), source: { kind: 'user' } })
    lead.session.append('user/message', message, { surfaceOp: 'append' })
    const request = { sessionId: lead.id, messageId: message.id, emoji: '👩🏽‍💻', active: true }
    await Promise.all([ctx.agentTeams.chatReact(request), ctx.agentTeams.chatReact(request)])
    await ctx.agentTeams.chatReact({ ...request, emoji: '❤️' })
    await ctx.agentTeams.chatReact({ ...request, active: false })
    const result = await ctx.agentTeams.chatMessages({ sessionId: lead.id })
    expect(result.messages[0]?.reactions).toEqual([expect.objectContaining({ emoji: '❤️', reactorKind: 'user' })])
    expect(adapter.requests).toHaveLength(0)
    await expect(ctx.agentTeams.chatReact({ ...request, emoji: 'not an emoji' })).rejects.toThrow(/emoji/)
    await expect(ctx.agentTeams.chatReact({ ...request, messageId: 'missing' })).rejects.toThrow(/not found/)
  })

  it('excludes inherited fork messages and rejects replies to unrelated sessions', async () => {
    const { ctx, lead } = await setup([], {}, true)
    const seed = createAssistantMessage({ source: { provider: 'mock', model: 'mock' }, content: content('Inherited response') })
    const child = ctx.sessions.create(SessionId('fork-chat'), { meta: { parentSession: lead.id, origin: 'subagent', seedLength: 1 }, seed: [
      { seq: 0, time: 1, surfaceOp: 'append', type: 'assistant/message', data: { turn: 1, step: 1, message: seed } },
    ] })
    expect((await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages).toEqual([])
    child.append('assistant/message', { turn: 2, step: 1, message: createAssistantMessage({ source: { provider: 'mock', model: 'mock' }, content: content('Own response') }) }, { surfaceOp: 'append' })
    expect((await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.map(row => row.text)).toEqual(['Own response'])
    const unrelated = ctx.sessions.create(SessionId('unrelated'))
    await expect(ctx.agentTeams.chatReply({ requestId: 'test-reply', sessionId: lead.id, targetId: unrelated.id, text: 'Hi' })).rejects.toThrow(/belong|member|child/)
  })
  it('delivers a contextual user intervention at the working agent’s next step, once for retries', async () => {
    const { ctx, lead, adapter } = await setup([
      toolCallResponse('pause-call', 'pause', {}, 'Found a discrepancy.'),
      textResponse('Prioritized the requested point.'), 'hang',
    ], {}, true)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    ctx.tools.register(defineTool({ name: 'pause', description: 'Hold a test tool', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
      async execute() { entered.resolve(undefined); await release.promise; return {} },
    }))
    const started = await spawn(ctx, lead, 'zenith')
    await entered.promise
    const before = await ctx.agentTeams.chatMessages({ sessionId: lead.id })
    const finding = before.messages.find(row => row.senderId === started.member.id)
    expect(finding?.text).toBe('Found a discrepancy.')
    const request = { requestId: 'contextual-user-reply', sessionId: lead.id, targetId: started.member.id,
      text: '@Zenith prioritize #12.', replyTo: finding!.id }
    await ctx.agentTeams.chatReply(request)
    await ctx.agentTeams.chatReply(request)
    const child = ctx.sessions.get(started.member.id)!
    const addressed = child.events.filter(event => event.type === 'agent/inbox/spliced'
      && event.data.inserted.some(message => message.content.some(block => block.type === 'text' && block.text.includes('[Team user message contextual-user-reply]'))))
    expect(addressed).toHaveLength(1)
    expect(addressed[0]?.data).toMatchObject({ target: 'next-step' })
    expect((await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.filter(row => row.id === request.requestId)).toHaveLength(1)
    release.resolve(undefined)
    await waitNoAgent(ctx, started.member.id)
    expect(adapter.requests[1]?.messages.some(message => message.content.some(block => block.type === 'text'
      && block.text.includes('Found a discrepancy.') && block.text.includes('@Zenith prioritize #12.')))).toBe(true)
    lead.cancel({ kind: 'user' })
    await lead.whenIdle()
  })

  it('prioritizes a directed user question at a safe boundary and continues the same child mission once', async () => {
    const effects: string[] = []
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const { ctx, lead, adapter, storageRoot } = await setup([
      toolCallResponse('work-start', 'write_file', { phase: 'first' }),
      (options) => {
        const delivered = options.messages.flatMap(message => message.content)
          .filter(block => block.type === 'text').map(block => block.text).join('\n')
        expect(delivered).toContain('User priority: answer this person at the next safe boundary')
        expect(delivered).toContain('Then continue your existing mission')
        expect(delivered).toContain('@Zenith why are you checking that first?')
        expect(delivered).toContain('Update the file in two phases.')
        return toolCallResponse('answer-user', 'team_chat_answer', { message_id: 'priority-user-question', text: 'Because it establishes the baseline.' })
      },
      toolCallResponse('work-continue', 'write_file', { phase: 'second' }),
      textResponse('The remaining check is complete.'), 'hang',
    ], {}, true)
    ctx.llm.registerAdapter(['other'], adapter)
    ctx.tools.register(defineTool({ name: 'write_file', description: 'Record a real mission checkpoint',
      parameters: { phase: { type: 'string', required: true } },
      output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
      async execute(args) {
        effects.push(args.phase)
        writeFileSync(join(storageRoot, 'mission.txt'), effects.join('\n'))
        if (args.phase === 'first') { entered.resolve(undefined); await release.promise }
        return {}
      },
    }))
    await ctx.plugin(TeamTools)
    const started = await ctx.agentTeams.spawnTeammate(lead, { name: 'zenith', description: 'Update the file in two phases.',
      prompt: content('Update the file in two phases.'), context: 'fresh', provider: 'spawn', signal: SIGNAL })
    await entered.promise
    const child = ctx.sessions.get(started.member.id)!
    persistModelSelectionPreference(lead.session, { provider: 'other', model: 'other-selected' }, 'explicit')
    const request = { requestId: 'priority-user-question', sessionId: lead.id, targetId: started.member.id,
      text: '@Zenith why are you checking that first?' }
    await ctx.agentTeams.chatReply(request)
    await ctx.agentTeams.chatReply(request)
    expect(effects).toEqual(['first'])
    expect(child.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    release.resolve(undefined)
    await waitNoAgent(ctx, started.member.id)
    expect(effects).toEqual(['first', 'second'])
    expect(readFileSync(join(storageRoot, 'mission.txt'), 'utf8')).toBe('first\nsecond')
    expect(child.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(child.events.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind)).toEqual(['completed'])
    const replies = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages
      .filter(row => row.senderId === child.id).map(row => row.text)
    expect(replies).toEqual([
      'Because it establishes the baseline.',
      'The remaining check is complete.\n\n✓ Evidencia ejecutada: write_file',
    ])
    expect(adapter.requests).toHaveLength(5)
    expect(adapter.requests[0]?.provider).toBe('mock')
    expect(adapter.requests.slice(1, 4).map(item => [item.provider, item.model]))
      .toEqual([['other', 'other-selected'], ['other', 'other-selected'], ['other', 'other-selected']])
    const correlated = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.find(row => row.replyTo === request.requestId)
    expect(correlated?.id).toBe(`${child.id}:answer:${request.requestId}`)
    lead.cancel({ kind: 'user' })
    await lead.whenIdle()
  })

  it('admits one correlated answer only after delivery and rejects foreign, operational, conflicting and stale callers', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const { ctx, lead } = await setup([toolCallResponse('wait-question', 'hold_question', {}), 'hang', 'hang'], {}, true)
    ctx.tools.register(defineTool({ name: 'hold_question', description: 'Hold the current action', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
      async execute() { entered.resolve(undefined); await release.promise; return {} },
    }))
    const target = await spawn(ctx, lead, 'zenith')
    await entered.promise
    const actor = ctx.agents.get(target.member.id)!
    const foreign = await spawn(ctx, lead, 'argo')
    const foreignActor = await waitRunning(ctx, foreign.member.id)
    const request = { requestId: 'answer-admission', sessionId: lead.id, targetId: actor.id, text: 'Why start there?' }
    await ctx.agentTeams.chatReply(request)
    await expect(ctx.agentTeams.answerChat(actor, { messageId: request.requestId, text: 'To establish the baseline.' })).rejects.toThrow('has not reached')
    await expect(ctx.agentTeams.answerChat(foreignActor, { messageId: request.requestId, text: 'Mine.' })).rejects.toThrow('not accepted')
    await expect(ctx.agentTeams.answerChat(lead, { messageId: request.requestId, text: 'Mine.' })).rejects.toThrow('non-child')
    await expect(ctx.agentTeams.answerChat(actor, { messageId: 'missing', text: 'Mine.' })).rejects.toThrow('not accepted')
    await expect(ctx.agentTeams.answerChat(actor, { messageId: request.requestId, text: ' ' })).rejects.toThrow('invalid')
    const unaccepted = { id: 'never-accepted', senderId: 'user', senderName: 'User', senderKind: 'user' as const,
      missionId: lead.id, text: 'Why?', time: Date.now(), sourceSeq: lead.session.events.length,
      targetId: actor.id, mentions: [actor.id], reactions: [], deliveries: [{ targetId: actor.id, accepted: false }] }
    lead.session.append('team/chat-message', { version: 1, message: unaccepted })
    await expect(ctx.agentTeams.answerChat(actor, { messageId: unaccepted.id, text: 'Mine.' })).rejects.toThrow('not accepted')
    await ctx.agentTeams.chatReply({ ...request, requestId: 'operational-answer', text: 'Send the email.' })
    await expect(ctx.agentTeams.answerChat(actor, { messageId: 'operational-answer', text: 'Sent.' })).rejects.toThrow('execution evidence')
    release.resolve(undefined)
    await vi.waitFor(() => { expect(actor.session.events.some(event => event.type === 'user/message'
      && event.data.content.some(block => block.type === 'text' && block.text.startsWith('[Team user message answer-admission]')))).toBe(true) })
    const answer = { messageId: request.requestId, text: 'To establish the baseline.' }
    const first = await ctx.agentTeams.answerChat(actor, answer)
    expect(await ctx.agentTeams.answerChat(actor, answer)).toEqual(first)
    await expect(ctx.agentTeams.answerChat(actor, { ...answer, text: 'Changed.' })).rejects.toThrow('conflicts')
    const transcript = await ctx.agentTeams.chatMessages({ sessionId: lead.id })
    expect(transcript.messages.filter(row => row.id === first.messageId)).toHaveLength(1)
    expect(transcript.messages.find(row => row.id === first.messageId)).toMatchObject({ replyTo: request.requestId, senderId: actor.id })
    actor.cancel({ kind: 'user' })
    foreignActor.cancel({ kind: 'user' })
    await waitNoAgent(ctx, actor.id)
    await waitNoAgent(ctx, foreignActor.id)
    await expect(ctx.agentTeams.answerChat(actor, answer)).rejects.toThrow('stale')
    lead.cancel({ kind: 'user' })
    await lead.whenIdle()
  })

  it('rejects an operational answer to a conversational question until the original action has a matching receipt', async () => {
    const { ctx, lead } = await setup(['hang'], {}, true)
    const started = await ctx.agentTeams.spawnTeammate(lead, { name: 'zenith', description: 'Send the email.',
      prompt: content('Send the email.'), context: 'fresh', provider: 'spawn', signal: SIGNAL })
    const actor = await waitRunning(ctx, started.member.id)
    const request = { requestId: 'email-status-question', sessionId: lead.id, targetId: actor.id, text: 'What is happening?' }
    await ctx.agentTeams.chatReply(request)
    actor.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: content(
      '[Team user message email-status-question]\nUser request: "What is happening?"\nReply context:\nWhat is happening?') }), { surfaceOp: 'append' })
    const claim = { messageId: request.requestId, text: 'I sent the email and verified delivery.' }
    await expect(ctx.agentTeams.answerChat(actor, claim)).rejects.toThrow('execution evidence')
    await expect(ctx.agentTeams.answerChat(actor, { ...claim, text: 'Done.' })).rejects.toThrow('execution evidence')
    for (const text of ['Verified means checked against evidence, and I sent the email.',
      'Verified means checked against evidence. I sent the email.', 'The email was sent.', 'Email sent.']) {
      await expect(ctx.agentTeams.answerChat(actor, { ...claim, text })).rejects.toThrow('execution evidence')
    }
    await expect(ctx.agentTeams.answerChat(actor, { ...claim, text: "I haven't sent it yet, but I sent another email." })).rejects.toThrow('execution evidence')
    for (const [index, text] of ["I haven't sent it yet.", 'Todavía no lo he enviado.'].entries()) {
      const negativeRequest = { ...request, requestId: `negative-status-${index}` }
      await ctx.agentTeams.chatReply(negativeRequest)
      actor.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: content(
        `[Team user message ${negativeRequest.requestId}]\nUser request: "What is happening?"\nReply context:\nWhat is happening?`) }), { surfaceOp: 'append' })
      expect(await ctx.agentTeams.answerChat(actor, { messageId: negativeRequest.requestId, text }))
        .toMatchObject({ messageId: `${actor.id}:answer:${negativeRequest.requestId}` })
    }
    expect(await ctx.agentTeams.answerChat(actor, { messageId: request.requestId, text: 'I have not sent the email yet.' }))
      .toMatchObject({ messageId: `${actor.id}:answer:${request.requestId}` })
    const logReceipt = (id: string, name: string) => {
      const callId = CallId(id)
      actor.session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' })
      actor.session.append('tool/result', { turn: 1, step: 1,
        message: createToolResultMessage({ callId, content: content('ok'), isError: false }) }, { surfaceOp: 'append' })
    }
    logReceipt('wrong-action', 'write_file')
    await expect(ctx.agentTeams.answerChat(actor, claim)).rejects.toThrow('execution evidence')
    logReceipt('send-email', 'mcp__Gmail__send_email')
    await expect(ctx.agentTeams.answerChat(actor, { ...claim, text: 'I deployed the website.' })).rejects.toThrow('execution evidence')
    // A new user question owns a new immutable answer identity.
    const verified = { ...request, requestId: 'email-status-verified' }
    await ctx.agentTeams.chatReply(verified)
    actor.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: content(
      '[Team user message email-status-verified]\nUser request: "What is happening?"\nReply context:\nWhat is happening?') }), { surfaceOp: 'append' })
    expect(await ctx.agentTeams.answerChat(actor, { ...claim, messageId: verified.requestId }))
      .toMatchObject({ messageId: `${actor.id}:answer:${verified.requestId}` })
    actor.cancel({ kind: 'user' })
    await waitNoAgent(ctx, actor.id)
    lead.cancel({ kind: 'user' })
    await lead.whenIdle()
  })

  it('requires an actual effect receipt for an operational answer when the original mission was conversational', async () => {
    const { ctx, lead } = await setup(['hang'], {}, true)
    const started = await ctx.agentTeams.spawnTeammate(lead, { name: 'zenith', description: 'Discuss the approach.',
      prompt: content('Discuss the approach.'), context: 'fresh', provider: 'spawn', signal: SIGNAL })
    const actor = await waitRunning(ctx, started.member.id)
    const request = { requestId: 'discussion-status', sessionId: lead.id, targetId: actor.id, text: 'What is happening?' }
    await ctx.agentTeams.chatReply(request)
    actor.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: content(
      '[Team user message discussion-status]\nUser request: "What is happening?"\nReply context:\nWhat is happening?') }), { surfaceOp: 'append' })
    const answer = { messageId: request.requestId, text: 'I created the file.' }
    await expect(ctx.agentTeams.answerChat(actor, answer)).rejects.toThrow('execution evidence')
    const callId = CallId('discussion-write')
    actor.session.append('tool/call', { turn: 1, step: 1, callId, name: 'write_file', arguments: '{}' })
    actor.session.append('tool/result', { turn: 1, step: 1,
      message: createToolResultMessage({ callId, content: content('ok'), isError: false }) }, { surfaceOp: 'append' })
    expect(await ctx.agentTeams.answerChat(actor, answer)).toMatchObject({ messageId: `${actor.id}:answer:${request.requestId}` })
    actor.cancel({ kind: 'user' })
    await waitNoAgent(ctx, actor.id)
    lead.cancel({ kind: 'user' })
    await lead.whenIdle()
  })

  it.each([
    ['How do I send an email?', 'Use the mail connector with the recipient, subject and text.'],
    ['¿Cómo puedo enviar un correo?', 'Usa el conector de correo e indica destinatario, asunto y texto.'],
    ['What does the test do?', 'It compares the observed output with the expected result.'],
    ['Explain how to create a file', 'Use write_file with the destination path and desired content.'],
    ['What does verified mean?', 'Verified means checked against evidence.'],
    ['How do I send an email?', 'After you click Send, the email is sent to the recipient.'],
    ['What does the test do?', 'A completed test reports success.'],
  ])('answers an instructional question before task execution without resetting its obligation: %s', async (question, explanation) => {
    const { ctx, lead } = await setup(['hang'], {}, true)
    const started = await ctx.agentTeams.spawnTeammate(lead, { name: 'zenith', description: 'Send the email.',
      prompt: content('Send the email.'), context: 'fresh', provider: 'spawn', signal: SIGNAL })
    const actor = await waitRunning(ctx, started.member.id)
    const request = { requestId: 'instructional-user-question', sessionId: lead.id, targetId: actor.id, text: question }
    await ctx.agentTeams.chatReply(request)
    actor.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: content(
      `[Team user message ${request.requestId}]\nUser request: ${JSON.stringify(question)}\nReply context:\n${question}`) }), { surfaceOp: 'append' })
    expect(await ctx.agentTeams.answerChat(actor, { messageId: request.requestId, text: explanation }))
      .toMatchObject({ messageId: `${actor.id}:answer:${request.requestId}` })
    expect(teamExecutionProof(actor.session.events)).toMatchObject({ requirement: 'effect', satisfied: false })
    const transcript = await ctx.agentTeams.chatMessages({ sessionId: lead.id })
    const visibleAnswer = transcript.messages.find(row => row.replyTo === request.requestId)
    expect(visibleAnswer?.text).toBe(explanation)
    actor.cancel({ kind: 'user' })
    await waitNoAgent(ctx, actor.id)
    lead.cancel({ kind: 'user' })
    await lead.whenIdle()
  })

  it('delivers the exact visible reaction target id with peer messages', async () => {
    const { ctx, lead } = await setup(['hang'], {}, true)
    const started = await spawn(ctx, lead, 'zenith')
    await waitRunning(ctx, started.member.id)
    const sent = await ctx.agentTeams.sendMessage(lead, {
      target: 'zenith',
      purpose: 'review',
      content: content('Please verify this result.'),
      delivery: 'quiet',
      signal: SIGNAL,
    })
    const child = ctx.sessions.get(started.member.id)!
    const delivered = ctx.agents.get(child.id)!.inbox.nextStep.find(message => message.source.kind === 'team-message'
      && message.source.messageId === sent.messageId)
    expect(delivered?.source.kind).toBe('team-message')
    if (delivered === undefined) throw new Error('team message was not accepted')
    const modelText = delivered.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(modelText).toContain(`Team message ${sent.messageId} from lead [review]:`)
    expect(modelText).toContain('Please verify this result.')
    expect(modelText).not.toContain('use team_chat_react once')
    ctx.agentTeams.interrupt(lead, 'zenith')
    await waitNoAgent(ctx, started.member.id)
  })

  it('keeps one multi-target user row across partial delivery retries and attributes all three reactor kinds', async () => {
    const { ctx, lead, adapter } = await setup([
      toolCallResponse('hold-a', 'hold', {}, 'Quality evidence.'),
      toolCallResponse('hold-b', 'hold', {}, 'Verification evidence.'),
      textResponse('Review complete.'), textResponse('Verification complete.'), 'hang',
    ], {}, true)
    const release = Promise.withResolvers<undefined>()
    let entered = 0
    ctx.tools.register(defineTool({ name: 'hold', description: 'Hold a test tool', parameters: {},
      output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
      async execute() { entered++; await release.promise; return {} },
    }))
    const zenith = await spawn(ctx, lead, 'zenith')
    const argo = await spawn(ctx, lead, 'argo')
    await vi.waitFor(() => { expect(entered).toBe(2) })
    const row = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.find(item => item.senderId === zenith.member.id)!
    const count = adapter.requests.length
    await ctx.agentTeams.chatReact({ sessionId: lead.id, messageId: row.id, emoji: '👍', active: true })
    await ctx.agentTeams.reactToChat(lead, { sessionId: lead.id, messageId: row.id, emoji: '🐍', active: true })
    await ctx.agentTeams.reactToChat(ctx.agents.get(argo.member.id)!, { sessionId: lead.id, messageId: row.id, emoji: '👀', active: true })
    expect(adapter.requests).toHaveLength(count)
    const reactions = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.find(item => item.id === row.id)?.reactions
    expect(reactions?.map(item => item.reactorKind)).toEqual(['user', 'kira', 'agent'])
    expect(reactions?.map(item => item.emoji)).toEqual(['👍', '🐍', '👀'])
    const realFollowup = ctx.subagents.followup.bind(ctx.subagents)
    const deliveries = vi.spyOn(ctx.subagents, 'followup').mockImplementationOnce(realFollowup).mockRejectedValueOnce(new Error('temporary delivery conflict'))
    const request = { requestId: 'shared-user-intervention', sessionId: lead.id, targetId: zenith.member.id,
      targetIds: [zenith.member.id, argo.member.id], text: '@Zenith @Argo focus on #12.', replyTo: row.id }
    await ctx.agentTeams.chatReply(request)
    const replyRow = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.find(item => item.id === request.requestId)
    expect(replyRow?.deliveries).toEqual([
      { targetId: zenith.member.id, accepted: true }, { targetId: argo.member.id, accepted: false, error: 'temporary delivery conflict' },
    ])
    deliveries.mockRestore()
    await ctx.agentTeams.chatReply(request)
    await ctx.agentTeams.chatReply(request)
    const visible = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.filter(item => item.id === request.requestId)
    expect(visible).toHaveLength(1)
    expect(visible[0]?.deliveries?.every(item => item.accepted)).toBe(true)
    for (const childId of [zenith.member.id, argo.member.id]) {
      expect(ctx.sessions.get(childId)?.events.filter(event => event.type === 'agent/inbox/spliced'
        && event.data.inserted.some(message => message.content.some(block => block.type === 'text' && block.text.includes('[Team user message shared-user-intervention]'))))).toHaveLength(1)
    }
    release.resolve(undefined)
    await waitNoAgent(ctx, zenith.member.id)
    await waitNoAgent(ctx, argo.member.id)
    lead.cancel({ kind: 'user' })
    await lead.whenIdle()
  })

  it('excludes model-only replacements and supports an ordinary user fork as a team root', async () => {
    const { ctx, lead } = await setup([], {}, true)
    const root = ctx.sessions.create(SessionId('user-fork-root'), { meta: { parentSession: lead.id } })
    const child = ctx.sessions.create(SessionId('fork-worker'), { meta: { parentSession: root.id, origin: 'subagent' } })
    const original = child.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({
      source: { provider: 'mock', model: 'mock' }, content: content('Public finding.'),
    }) }, { surfaceOp: 'append' })
    child.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({
      source: { provider: 'mock', model: 'mock' }, content: content('Model-only replacement.'),
    }) }, { surfaceOp: { op: 'replace', start: original.seq, end: original.seq }, sourceEventSeqs: [original.seq] })
    expect((await ctx.agentTeams.chatMessages({ sessionId: root.id })).messages.map(row => row.text)).toEqual(['Public finding.'])
  })

  it('retains completed and failed personas when first read backfills historical children', async () => {
    const { ctx, lead, adapter } = await setup([], {}, true)
    for (const [id, reason, expected] of [
      ['historical-done', { kind: 'completed' as const }, 'done'],
      ['historical-failed', { kind: 'error' as const, error: { code: 'UNKNOWN', message: 'Failed verification' } }, 'failed'],
    ] as const) {
      const child = ctx.sessions.create(SessionId(id), { meta: { parentSession: lead.id, origin: 'subagent' } })
      child.append('turn/start', { turn: 1 })
      child.append('assistant/message', { turn: 1, step: 1, message: createAssistantMessage({
        source: { provider: 'mock', model: 'mock' }, content: content(id),
      }) }, { surfaceOp: 'append' })
      child.append('turn/end', { turn: 1, reason })
      const first = await ctx.agentTeams.chatMessages({ sessionId: lead.id })
      expect(first.participants.find(person => person.id === id)?.status).toBe(expected)
      const second = await ctx.agentTeams.chatMessages({ sessionId: lead.id })
      expect(second.participants.find(person => person.id === id)).toEqual(first.participants.find(person => person.id === id))
    }
    expect(adapter.requests).toHaveLength(0)
  })

  it('recovers a delivered reply whose supervisory checkpoint failed without reinjecting the notice', async () => {
    const { ctx, lead } = await setup(['hang'], {}, true)
    const started = await spawn(ctx, lead, 'supervised-worker')
    await waitRunning(ctx, started.member.id)
    const originalInject = lead.inject.bind(lead)
    const inject = vi.spyOn(lead, 'inject').mockImplementationOnce((message) => {
      originalInject(message)
      throw new Error('checkpoint unavailable')
    })
    const request = { requestId: 'supervision-recovery', sessionId: lead.id, targetId: started.member.id, text: 'User priority' }
    await expect(ctx.agentTeams.chatReply(request)).rejects.toThrow('checkpoint unavailable')
    inject.mockRestore()
    await teamInternals(ctx).recoverFor(lead)
    const row = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.find(message => message.id === request.requestId)
    expect(row?.supervised).toBe(true)
    expect(row?.deliveries).toEqual([{ targetId: started.member.id, accepted: true }])
    const notices = lead.session.events.filter(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message =>
      message.content.some(block => block.type === 'text' && block.text.includes('[Team supervision supervision-recovery]'))))
    expect(notices).toHaveLength(1)
  })

  it('closes reply admission and drains publication before Team unload completes', async () => {
    const { ctx, lead, teamFiber } = await setup(['hang'], {}, true)
    const service = ctx.agentTeams
    const started = await spawn(ctx, lead, 'chat-disposal-worker')
    await waitRunning(ctx, started.member.id)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.subagents, 'followup').mockImplementationOnce(async (_lead, _target, _content, options) => {
      entered.resolve(undefined)
      await release.promise
      options.signal.throwIfAborted()
      throw new Error('must not admit after disposal')
    })
    const reply = service.chatReply({ requestId: 'unloaded-reply', sessionId: lead.id, targetId: started.member.id, text: 'Pending reply' })
    const rejected = expect(reply).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    await entered.promise
    const unloading = teamFiber.dispose()
    release.resolve(undefined)
    await rejected
    await unloading
    const count = lead.session.events.length
    await expect(service.chatReact({ sessionId: lead.id, messageId: 'unloaded-reply', emoji: '👍', active: true })).rejects.toMatchObject({ code: 'TEAM_DISPOSED' })
    expect(lead.session.events).toHaveLength(count)
  })

  it('exposes the initial Kira assignment as a reaction target while the teammate is provisioning', async () => {
    const { ctx, lead, adapter } = await setup([], {}, true)
    const childId = SessionId('provisioning-reaction-target')
    lead.session.append('team/member', {
      version: 1,
      teamId: TeamId(lead.id),
      member: {
        id: childId,
        name: 'zenith',
        description: 'verify the result',
        provider: 'spawn',
        context: 'fresh',
        phase: 'provisioning',
      },
    })
    const row = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages
      .find(message => message.id === `team-member:${childId}`)
    expect(row).toMatchObject({
      senderKind: 'kira',
      senderId: lead.id,
      targetId: childId,
      text: 'verify the result',
    })
    expect(adapter.requests).toHaveLength(0)
  })

  it('shows the addressed initial task rather than the roster description', async () => {
    const { ctx, lead } = await setup(['hang'], {}, true)
    const started = await ctx.agentTeams.spawnTeammate(lead, {
      name: 'argo', description: 'Research assignment',
      prompt: content('Busca fuentes anteriores al corte y explica los bloqueos.'),
      context: 'fresh', provider: 'spawn', signal: SIGNAL,
    })
    const rows = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages
      .filter(row => row.id === `team-member:${started.member.id}`)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.text).toBe('Argo, Busca fuentes anteriores al corte y explica los bloqueos.')
    expect(rows[0]?.targetId).toBe(started.member.id)
    ctx.agentTeams.interrupt(lead, 'argo')
    await waitNoAgent(ctx, started.member.id)
  })

  it('gives a new teammate the exact visible Kira assignment id in its first prompt', async () => {
    const { ctx, lead, adapter } = await setup(['hang'], {}, true)
    const started = await spawn(ctx, lead, 'zenith')
    await vi.waitFor(() => { expect(adapter.requests.length).toBeGreaterThan(0) })
    const promptText = adapter.requests[0]?.messages
      .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
      .join('\n') ?? ''
    expect(promptText).toContain(`Visible Kira assignment reaction target: team-member:${started.member.id}`)
    expect(promptText).toContain('team_chat_react')
    expect(promptText).toContain('Execute the real work before sending an update')
    expect(promptText).toContain('do NOT call send_message just to acknowledge')
    expect(promptText).toContain('Do not end after announcing your plan')
    expect(promptText).toContain('send_message to lead with purpose result or blocker')
    ctx.agentTeams.interrupt(lead, 'zenith')
    await waitNoAgent(ctx, started.member.id)
  })

  it('keeps Aegis silent instead of forcing an assignment reaction', async () => {
    const { ctx, lead, adapter } = await setup(['hang'], {}, true)
    const started = await spawn(ctx, lead, 'aegis')
    await vi.waitFor(() => { expect(adapter.requests.length).toBeGreaterThan(0) })
    const promptText = adapter.requests[0]?.messages
      .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
      .join('\n') ?? ''
    expect(promptText).toContain('Aegis silent review mode')
    expect(promptText).toContain('Do not acknowledge this assignment with a reaction or status message')
    expect(promptText).not.toContain('Visible Kira assignment reaction target')
    expect(promptText).not.toContain('In your first normal work step')
    ctx.agentTeams.interrupt(lead, 'aegis')
    await waitNoAgent(ctx, started.member.id)
  })

  it('lets every participant react to the real initial Kira assignment', async () => {
    const { ctx, lead, adapter } = await setup(['hang'], {}, true)
    const started = await spawn(ctx, lead, 'zenith')
    const messageId = `team-member:${started.member.id}`
    const before = adapter.requests.length
    await expect(ctx.agentTeams.chatReact({ sessionId: lead.id, messageId, emoji: '🚀', active: true })).resolves.toBeUndefined()
    const row = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.find(message => message.id === messageId)
    expect(row).toMatchObject({ senderKind: 'kira', senderId: lead.id, targetId: started.member.id })
    expect(row?.reactions).toMatchObject([{ reactorKind: 'user', emoji: '🚀' }])
    expect(adapter.requests).toHaveLength(before)
  })

  it('keeps captured and peer history readable in a fork but rejects cross-mission reactions', async () => {
    const { ctx, lead } = await setup(['hang'], {}, true)
    await spawn(ctx, lead, 'zenith')
    lead.session.append('team/chat-message', { version: 1, message: {
      id: 'original-captured', senderId: 'original-worker', senderName: 'Zenith', senderKind: 'agent',
      missionId: lead.id, text: 'Original evidence', time: 1, sourceSeq: 0, mentions: [], reactions: [],
    } })
    const peer = await ctx.agentTeams.sendMessage(lead, {
      target: 'zenith', content: content('Original coordination'), delivery: 'quiet', signal: SIGNAL,
    })
    const fork = ctx.sessions.create(SessionId('readonly-history-fork'), {
      meta: { parentSession: lead.id }, seed: [...lead.session.events],
    })
    const read = await ctx.agentTeams.chatMessages({ sessionId: fork.id })
    expect(read.messages.some(message => message.id === 'original-captured')).toBe(true)
    expect(read.messages.some(message => message.id === peer.messageId)).toBe(true)
    const count = fork.events.length
    for (const messageId of ['original-captured', peer.messageId]) {
      await expect(ctx.agentTeams.chatReact({ sessionId: fork.id, messageId, emoji: '👍', active: true }))
        .rejects.toThrow('another mission')
    }
    expect(fork.events).toHaveLength(count)
  })

})
