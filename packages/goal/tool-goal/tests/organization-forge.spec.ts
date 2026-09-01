import { describe, expect, it } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import AgentRegistry, { Inbox } from '@phoenix-ai/dsh-agent'
import type { Agent } from '@phoenix-ai/dsh-agent'
import GoalService from '@phoenix-ai/dsh-goal'
import { CallId, createUserMessage } from '@phoenix-ai/dsh-llm'
import type { MessageSource } from '@phoenix-ai/dsh-llm'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import SystemPrompt from '@phoenix-ai/dsh-system-prompt'
import ToolRuntime from '@phoenix-ai/dsh-tools'
import type { ToolExecutionResult } from '@phoenix-ai/dsh-tools'
import * as toolGoal from '@phoenix-ai/dsh-tool-goal'

const signal = new AbortController().signal

function rootAgent(session: Session): Agent {
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  return {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'running',
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: (input) => { inbox.append('next-step', input) },
    cancel: () => {},
    runMaintenance: (task) => { return task(new AbortController().signal) },
    whenIdle: () => Promise.resolve(),
  }
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(GoalService)
  await ctx.plugin(toolGoal, { requireJudge: false })
  const session = Session.create(SessionId(`forge-tool-test-${Math.random()}`))
  const agent = rootAgent(session)
  ctx.agents.register(agent)
  return { ctx, agent, session }
}

function openTurn(agent: Agent, source: MessageSource): void {
  const turn = agent.session.events.filter(event => event.type === 'turn/start').length + 1
  const message = createUserMessage({ content: [{ type: 'text', text: 'Build the requested organization.' }], source })
  agent.inbox.append('next-turn', message)
  const claimed = agent.inbox.claim('next-turn', turn)
  if (claimed.length === 0) throw new Error('expected accepted turn')
  agent.session.append('turn/start', { turn })
  for (const admitted of claimed) agent.session.append('user/message', admitted, { surfaceOp: 'append' })
}

async function execute(ctx: Context, agent: Agent, args: Record<string, unknown>): Promise<ToolExecutionResult> {
  return ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    signal,
    callId: CallId(`forge-call-${Math.random()}`),
    name: 'organization_forge',
    arguments: args,
    agent,
  }))
}

function resultJson(result: ToolExecutionResult): Record<string, unknown> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected successful Organization Forge action')
  const block = result.content[0]
  if (block?.type !== 'text') throw new Error('expected JSON tool result')
  return JSON.parse(block.text) as Record<string, unknown>
}

function forge(result: ToolExecutionResult): Record<string, unknown> {
  const value = resultJson(result).forge
  if (typeof value !== 'object' || value === null) throw new Error('expected Forge projection')
  return value as Record<string, unknown>
}

describe('organization_forge model tool', () => {
  it('exposes the complete research-to-judge workflow and next action', async () => {
    const { ctx, agent } = await harness()
    openTurn(agent, { kind: 'user' })
    const started = await execute(ctx, agent, { action: 'start', objective: 'Build a secure operations system' })
    expect(resultJson(started).nextAction).toBe('research')
    let value = forge(started)
    const id = value.id
    if (typeof id !== 'string') throw new Error('expected Forge id')

    value = forge(await execute(ctx, agent, {
      action: 'research', forge_id: id, research_kind: 'repository', research_title: 'Comparable system',
      locator: 'https://github.com/example/system', research_summary: 'Public reference', research_relevance: 'Architecture comparison',
    }))
    value = forge(await execute(ctx, agent, {
      action: 'source', forge_id: id, title: 'Audited source', locator: 'local:source', license: 'original',
    }))
    const sources = value.sources as Array<Record<string, unknown>>
    const sourceId = sources[0]?.id
    if (typeof sourceId !== 'string') throw new Error('expected source id')
    for (const stage of ['pre-reuse', 'post-modification']) {
      value = forge(await execute(ctx, agent, {
        action: 'audit', forge_id: id, stage, source_id: sourceId, license: 'passed', dependencies: 'passed',
        secrets: 'passed', vulnerabilities: 'passed', evidence: [`audit:${stage}`],
      }))
    }
    value = forge(await execute(ctx, agent, {
      action: 'blueprint', forge_id: id, components: ['api'], infrastructure: ['sandbox'], automations: ['health check'],
      workflows: ['research-build-verify'], metrics: ['pass rate'], cost_controls: ['deterministic checks'], quality_targets: ['verified'],
    }))
    value = forge(await execute(ctx, agent, { action: 'advance', forge_id: id, phase: 'building' }))
    value = forge(await execute(ctx, agent, { action: 'deliverable', forge_id: id, deliverable_name: 'service', deliverable_kind: 'software', artifact_ref: 'artifact:service' }))
    const deliverables = value.deliverables as Array<Record<string, unknown>>
    const deliverableId = deliverables[0]?.id
    if (typeof deliverableId !== 'string') throw new Error('expected deliverable id')
    value = forge(await execute(ctx, agent, {
      action: 'criterion', forge_id: id, criterion_id: 'criterion-1', criterion_status: 'verified', evidence: ['test:functional'],
    }))
    value = forge(await execute(ctx, agent, {
      action: 'work', forge_id: id, role: 'it', work_title: 'Build service', work_status: 'completed', evidence: ['test:service'],
    }))
    value = forge(await execute(ctx, agent, {
      action: 'strategy', forge_id: id, strategy_name: 'primary', strategy_status: 'completed', strategy_summary: 'Primary implementation', evidence: ['build:service'],
    }))
    value = forge(await execute(ctx, agent, {
      action: 'deliverable', forge_id: id, deliverable_id: deliverableId, deliverable_status: 'verified', evidence: ['test:service', 'smoke:service'],
    }))
    value = forge(await execute(ctx, agent, { action: 'advance', forge_id: id, phase: 'verifying' }))
    value = forge(await execute(ctx, agent, { action: 'revalidate', forge_id: id, source_id: sourceId, evidence: ['review:current'] }))
    value = forge(await execute(ctx, agent, {
      action: 'atlas', forge_id: id, atlas_name: 'service pattern', atlas_summary: 'Reusable service workflow',
      reusable_pattern: 'Run deterministic checks before deployment', source_id: sourceId,
    }))
    expect(value.atlasEntries).toHaveLength(1)
    expect(value.work).toEqual([])
    expect(resultJson(await execute(ctx, agent, { action: 'judge', forge_id: id })).forge).toMatchObject({ phase: 'blocked' })
    value = forge(await execute(ctx, agent, { action: 'advance', forge_id: id, phase: 'verifying' }))
    expect(value.phase).toBe('verifying')
    value = forge(await execute(ctx, agent, {
      action: 'block', forge_id: id, dependency: 'judge provider', blocker_reason: 'Review service is unavailable',
      resume_condition: 'Review service responds with a structured verdict',
    }))
    expect(value.blocker).toMatchObject({ dependency: 'judge provider' })
    expect(resultJson(await execute(ctx, agent, { action: 'get', forge_id: id })).nextAction).toBe('recover')
    expect(forge(await execute(ctx, agent, { action: 'advance', forge_id: id, phase: 'verifying' }))).toMatchObject({ phase: 'verifying' })
    expect(JSON.stringify(value.atlasEntries)).not.toMatch(/api[_-]?key|token|secret|password|authorization/i)
  })
})
