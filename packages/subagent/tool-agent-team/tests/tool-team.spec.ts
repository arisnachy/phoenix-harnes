import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import type { Agent } from '@phoenix-ai/dsh-agent'
import AgentLoop from '@phoenix-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@phoenix-ai/dsh-agent-loop-testkit'
import {
  CallId,
  ReasoningEffortId,
  createToolResultMessage,
  type LlmModelReasoningInfo,
} from '@phoenix-ai/dsh-llm'
import { scopeOf } from '@phoenix-ai/dsh-scope'
import { SessionId } from '@phoenix-ai/dsh-session'
import SessionProjections from '@phoenix-ai/dsh-session-projection'
import JsonlSessionPersistence from '@phoenix-ai/dsh-session-persistence-jsonl'
import SubagentService from '@phoenix-ai/dsh-subagent'
import * as SubagentFork from '@phoenix-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@phoenix-ai/dsh-subagent-spawn-in-process'
import { renderPrompt } from '@phoenix-ai/dsh-system-prompt'
import * as ToolSubagentControl from '@phoenix-ai/dsh-tool-subagent-control'
import { defineContentToolFixture } from '@phoenix-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import TeamService from '../../agent-team/src/index.ts'
import * as toolTeam from '../src/index.ts'

const SIGNAL = new AbortController().signal
const TOOL_NAMES = [
  'spawn_teammate',
  'send_message',
  'followup_task',
  'team_react',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'team_task_create',
  'team_task_list',
  'team_task_get',
  'team_task_update',
].sort()

const roots: string[] = []
let callNumber = 0

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function setup(
  script: ConstructorParameters<typeof MockAdapter>[0],
  legacyControl = false,
  config: toolTeam.Config = {},
  reasoning?: LlmModelReasoningInfo,
) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-tool-team-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SubagentService)
  if (legacyControl) await ctx.plugin(ToolSubagentControl)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  await ctx.plugin(TeamService)
  const fiber = await ctx.plugin(toolTeam, config)
  const adapter = new MockAdapter(script, reasoning)
  ctx.llm.registerAdapter(['mock'], adapter)
  const lead = ctx.agentLoop.create(SessionId('tool-team-lead'), { provider: 'mock', model: 'mock' })
  return { ctx, lead, fiber }
}

function execute(
  ctx: Context,
  agent: Agent | undefined,
  name: string,
  args: unknown,
  signal: AbortSignal = SIGNAL,
) {
  return ctx.tools.execute({
    callId: CallId(`team-call-${++callNumber}`),
    name,
    arguments: args,
    signal,
    ...agent === undefined ? {} : { agent },
  })
}

function text(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

function spawnedChildId(result: Awaited<ReturnType<typeof execute>>): SessionId {
  const parsed: unknown = JSON.parse(text(result))
  if (typeof parsed !== 'object' || parsed === null || !('member' in parsed)) {
    throw new Error('spawn_teammate result has no member')
  }
  const member = parsed.member
  if (typeof member !== 'object' || member === null || !('id' in member) || typeof member.id !== 'string') {
    throw new Error('spawn_teammate result has no member id')
  }
  return SessionId(member.id)
}

async function assembly(ctx: Context, agent: Agent) {
  const scope = scopeOf(agent.ctx)
  if (scope === undefined) throw new Error('expected Agent scope')
  return ctx.systemPrompt.assemble({ scope })
}

async function waitRunning(ctx: Context, id: SessionId): Promise<Agent> {
  return vi.waitFor(() => {
    const child = ctx.agents.get(id)
    expect(child?.status).toBe('running')
    return child!
  }, { timeout: 5_000 })
}

async function waitNoAgent(ctx: Context, id: SessionId): Promise<void> {
  await vi.waitFor(() => { expect(ctx.agents.get(id)).toBeUndefined() }, { timeout: 5_000 })
}

describe('dsh-tool-team', () => {
  it('installs the complete scoped schema and shared-checkout policy for roots and teammates', async () => {
    const { ctx, lead } = await setup(['hang'])
    const leadAssembly = await assembly(ctx, lead)
    expect(leadAssembly.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    const leadPrompt = renderPrompt(leadAssembly)
    expect(leadPrompt).toContain('real shared work, not role-play')
    expect(leadPrompt).toContain('Fénix Eclipse is explicitly authorized to use this Team path')
    expect(leadPrompt).toContain('prefer spawn_teammate over legacy subagent delegation')
    expect(leadPrompt).toContain('one teammate is normal')
    expect(leadPrompt).toContain('a third is reserved for exceptional complexity')
    expect(leadPrompt).toContain('never exceed three')
    expect(leadPrompt).toContain('outside OpenAI Codex every teammate MUST inherit exactly the currently selected provider and model')
    expect(leadPrompt).toContain('Never claim a teammate is running from intent alone')
    expect(leadPrompt).toContain('compare expected quality gain and time saved against added model consumption')
    expect(leadPrompt).toContain('stop a redundant worker when its outcome is no longer needed')
    expect(leadPrompt).toContain('unused KIRA codename')
    expect(leadPrompt).toContain('vortice, aurora, atlas')
    expect(leadPrompt).toContain('FS_STALE_VERSION')
    expect(leadPrompt).toContain('Bash, formatters, code generators, and scripts are not fully protected')
    expect(leadPrompt).toContain('Task readiness never starts an owner')
    expect(leadPrompt).toContain('returns noProgress immediately')
    expect(leadPrompt).toContain('cognitively independent only when its reported modelProvider or model differs')
    expect(leadPrompt).toContain('team_chat_react')
    expect(leadPrompt).toContain('team_chat_react as the canonical visible social reaction')
    expect(leadPrompt).toContain('Reactions are optional')
    expect(leadPrompt).not.toContain('emit exactly one natural reaction')
    expect(leadPrompt).toContain('A directed user question takes priority at the next safe boundary')
    expect(leadPrompt).toContain('Routine status updates are exempt')
    expect(leadPrompt).toContain('team_react is a legacy semantic peer-message compatibility tool')
    expect(leadPrompt).toContain('must send it to lead with purpose result before ending its turn')
    expect(leadPrompt).toContain('spawn_teammate is itself the initial assignment')
    expect(leadPrompt).toContain('root Phoenix chat is the shared Team room')
    expect(leadPrompt).toContain('route the substantive request with followup_task')
    expect(leadPrompt).toContain('Your Team role is lead')
    expect(leadPrompt).toContain('Warm, confident, curious, and witty')
    expect(leadPrompt).toContain('high quality, fast completion, and low cost')
    expect(leadPrompt).toContain('never synthesize roster filenames')
    expect(leadPrompt).toContain('Phoenix has no repository-root cordis.yml')

    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'tool-worker',
      description: 'exercise scoped tools',
      prompt: 'stay available',
    })
    expect(spawned.isError).toBe(false)
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)
    const childAssembly = await assembly(ctx, child)
    expect(childAssembly.tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    const childPrompt = renderPrompt(childAssembly)
    expect(childPrompt).toContain('Your Team role is teammate; your Team name is tool-worker')
    expect(childPrompt).toContain('Natural, concise, collegial')
    expect(childPrompt).toContain('never synthesize roster filenames')
    expect(childPrompt).toContain('Phoenix has no repository-root cordis.yml')
    expect(childPrompt).not.toContain('detective-like')

    const denied = await execute(ctx, child, 'spawn_teammate', {
      name: 'nested', description: 'not allowed', prompt: 'no',
    })
    expect(denied.isError).toBe(true)
    expect(text(denied)).toContain('only the Team Lead')
    await execute(ctx, lead, 'interrupt_agent', { target: 'tool-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('injects only the active named KIRA persona instead of all twenty voices', async () => {
    const { ctx, lead } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'argo',
      description: 'verify result and evidence',
      prompt: 'stay available',
    })
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)
    const prompt = renderPrompt(await assembly(ctx, child))
    expect(prompt).toContain('Your Team role is teammate; your Team name is argo; Team id is tool-team-lead.')
    expect(prompt).toContain('detective-like')
    expect(prompt).toContain('understated dry humor')
    expect(prompt).not.toContain('Playfully adversarial')
    expect(prompt).not.toContain('Warm, empathetic, creative')
    await execute(ctx, lead, 'interrupt_agent', { target: 'argo' })
    await waitNoAgent(ctx, childId)
  })

  it('auto-selects distinct human specialist identities when the Lead omits a name', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'])
    const security = await execute(ctx, lead, 'spawn_teammate', {
      description: 'security audit authentication risk',
      prompt: 'inspect the authentication boundary and report concrete exposure',
    })
    expect(security.isError).toBe(false)
    const securityValue = JSON.parse(text(security)) as { member: { id: string; name: string } }
    expect(['cobalto', 'eclipse', 'zenith']).toContain(securityValue.member.name)
    const securityChild = await waitRunning(ctx, SessionId(securityValue.member.id))
    const securityPrompt = renderPrompt(await assembly(ctx, securityChild))
    expect(securityPrompt.toLowerCase()).toContain(`Your Team name is ${securityValue.member.name}`.toLowerCase())
    expect(securityPrompt).not.toContain('Natural, concise, collegial')

    const design = await execute(ctx, lead, 'spawn_teammate', {
      description: 'responsive UX visual design and animation',
      prompt: 'review the interface and return specific visual improvements',
    })
    expect(design.isError).toBe(false)
    const designValue = JSON.parse(text(design)) as { member: { id: string; name: string } }
    expect(['vega', 'aurora', 'prisma']).toContain(designValue.member.name)
    expect(designValue.member.name).not.toBe(securityValue.member.name)
    await waitRunning(ctx, SessionId(designValue.member.id))

    await execute(ctx, lead, 'interrupt_agent', { target: securityValue.member.name })
    await execute(ctx, lead, 'interrupt_agent', { target: designValue.member.name })
    await waitNoAgent(ctx, SessionId(securityValue.member.id))
    await waitNoAgent(ctx, SessionId(designValue.member.id))
  })

  it('does not let an explicit model profile override a non-Codex selected route', async () => {
    const { ctx, lead } = await setup(['hang'], false, {
      defaultModelProfile: 'judge',
      modelProfiles: {
        judge: { provider: 'other-provider', model: 'independent-judge', maxTokens: 8192, reasoningEffort: 'high' },
      },
    })
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'judge',
      description: 'stay on the exact selected non-Codex model',
      prompt: 'review the evidence',
      model_profile: 'judge',
    })
    expect(spawned.isError).toBe(false)
    const child = await waitRunning(ctx, spawnedChildId(spawned))
    expect(child.options).toMatchObject({ provider: 'mock', model: 'mock' })
    expect(child.options.model).not.toBe('independent-judge')
    const rosterMember: unknown = JSON.parse(text(spawned))
    expect(rosterMember).toMatchObject({ member: {
      modelProvider: 'mock',
      model: 'mock',
    } })
    await execute(ctx, lead, 'interrupt_agent', { target: 'judge' })
  })

  it('does not let a same-provider default profile change the selected non-Codex model', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'], false, {
      defaultModelProfile: 'other-mock-model',
      modelProfiles: {
        'other-mock-model': { provider: 'mock', model: 'different-model' },
      },
    })

    const inherited = await execute(ctx, lead, 'spawn_teammate', {
      name: 'inherited-same-model',
      description: 'must keep the selected non-Codex model',
      prompt: 'wait',
    })
    const inheritedChild = await waitRunning(ctx, spawnedChildId(inherited))
    expect(inheritedChild.options).toMatchObject({ provider: 'mock', model: 'mock' })
    expect(inheritedChild.options.model).not.toBe('different-model')

    const explicit = await execute(ctx, lead, 'spawn_teammate', {
      name: 'explicit-other-model',
      description: 'explicit profile override',
      prompt: 'wait',
      model_profile: 'other-mock-model',
    })
    const explicitChild = await waitRunning(ctx, spawnedChildId(explicit))
    expect(explicitChild.options).toMatchObject({ provider: 'mock', model: 'mock' })
    expect(explicitChild.options.model).not.toBe('different-model')

    await execute(ctx, lead, 'interrupt_agent', { target: 'inherited-same-model' })
    await execute(ctx, lead, 'interrupt_agent', { target: 'explicit-other-model' })
  })

  it('uses the live selector request route instead of stale Agent options outside Codex', async () => {
    const { ctx, lead } = await setup(['hang'], false, {
      defaultModelProfile: 'luna-max',
      modelProfiles: {
        'luna-max': { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' },
      },
    })
    const codex = new MockAdapter(['hang'], {
      efforts: [{ id: ReasoningEffortId('max'), name: 'Max' }],
      defaultEffort: ReasoningEffortId('max'),
    })
    ctx.llm.registerAdapter(['openai-codex'], codex)

    // Reproduce a session that was created on Codex but whose visible selector
    // has since moved to another provider/model for this live turn.
    lead.options.provider = 'openai-codex'
    lead.options.model = 'gpt-6.1-sol'
    lead.session.append('turn/start', { turn: 1 })
    lead.session.append('request/header', {
      header: { config: { provider: 'mock', model: 'mock' } },
      reason: 'initial',
    })

    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'same-selected-worker',
      description: 'inherit the visible selected non-Codex route',
      prompt: 'wait',
    })
    expect(spawned.isError).toBe(false)
    const child = await waitRunning(ctx, spawnedChildId(spawned))
    expect(child.options).toMatchObject({ provider: 'mock', model: 'mock' })
    expect(child.options.provider).not.toBe('openai-codex')
    expect(child.options.model).not.toBe('gpt-6-luna')
    expect(codex.requests).toHaveLength(0)
    await execute(ctx, lead, 'interrupt_agent', { target: 'same-selected-worker' })
  })

  it('keeps the selected Codex planner while real teammates execute on Luna Max', async () => {
    const { ctx, lead } = await setup([], false, {
      defaultModelProfile: 'luna-max',
      modelProfiles: { 'luna-max': { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' } },
    })
    const codex = new MockAdapter(['hang'], {
      efforts: [{ id: ReasoningEffortId('max'), name: 'Max' }], defaultEffort: ReasoningEffortId('max'),
    })
    ctx.llm.registerAdapter(['openai-codex'], codex)
    lead.options.provider = 'openai-codex'
    lead.options.model = 'gpt-6.1-sol'
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'luna-worker', description: 'bounded execution', prompt: 'wait for instructions',
    })
    const child = await waitRunning(ctx, spawnedChildId(spawned))
    expect(child.options).toMatchObject({ provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'max' })
    expect(lead.options).toMatchObject({ provider: 'openai-codex', model: 'gpt-6.1-sol' })
    expect(codex.requests.every(request => request.sessionId === child.id)).toBe(true)
    await execute(ctx, lead, 'interrupt_agent', { target: 'luna-worker' })
  })

  it('inherits the exact non-Codex Lead route even when foreign profiles are configured or requested', async () => {
    const { ctx, lead } = await setup(['hang', 'hang'], false, {
      defaultModelProfile: 'foreign',
      modelProfiles: {
        foreign: { provider: 'other-provider', model: 'foreign-model' },
        explicit: { provider: 'mock', model: 'explicit-model' },
      },
    })

    const inherited = await execute(ctx, lead, 'spawn_teammate', {
      name: 'inherited-worker',
      description: 'inherit Lead route',
      prompt: 'wait',
    })
    const inheritedChild = await waitRunning(ctx, spawnedChildId(inherited))
    expect(inheritedChild.options).toMatchObject({ provider: 'mock', model: 'mock' })

    const explicit = await execute(ctx, lead, 'spawn_teammate', {
      name: 'explicit-worker',
      description: 'use explicit route',
      prompt: 'wait',
      model_profile: 'explicit',
    })
    const explicitChild = await waitRunning(ctx, spawnedChildId(explicit))
    expect(explicitChild.options).toMatchObject({ provider: 'mock', model: 'mock' })
    expect(explicitChild.options.model).not.toBe('explicit-model')
    expect(explicitChild.options.maxTokens).toBeUndefined()
    expect(explicitChild.options.reasoningEffort).toBeUndefined()

    await execute(ctx, lead, 'interrupt_agent', { target: 'inherited-worker' })
    await execute(ctx, lead, 'interrupt_agent', { target: 'explicit-worker' })
  })

  it('rejects a dangling default model profile before touching Team runtime services', () => {
    expect(() => {
      toolTeam.apply(new Context(), {
        defaultModelProfile: 'missing',
        modelProfiles: {},
      })
    }).toThrow('defaultModelProfile "missing" is not declared in modelProfiles')
  })

  it('returns actionable no-progress output and renders structured wait cancellation', async () => {
    const inactiveSetup = await setup([textResponse('worker done')])
    const inactiveSpawn = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'spawn_teammate', {
      name: 'inactive-worker', description: 'finish immediately', prompt: 'finish',
    })
    const inactiveId = spawnedChildId(inactiveSpawn)
    await waitNoAgent(inactiveSetup.ctx, inactiveId)
    const noProgress = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'wait_agent', { timeout_ms: 3_600_000 })
    expect(noProgress.isError).toBe(false)
    expect(JSON.parse(text(noProgress))).toEqual({
      timedOut: false,
      noProgress: {
        reason: 'no-active-peer',
        message: 'No other Team member is running or provisioning. wait_agent cannot make progress or wake inactive teammates. Re-list with list_agents and team_task_list, then use followup_task to wake each required inactive teammate before waiting again.',
      },
    })
    for (const timeout_ms of [9_999, 3_600_001, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = await execute(inactiveSetup.ctx, inactiveSetup.lead, 'wait_agent', { timeout_ms })
      expect(invalid.isError).toBe(true)
      expect(text(invalid)).toContain('timeoutMs must be an integer from 10000 through 3600000')
    }

    const activeSetup = await setup(['hang'])
    const activeSpawn = await execute(activeSetup.ctx, activeSetup.lead, 'spawn_teammate', {
      name: 'active-worker', description: 'stay active', prompt: 'wait',
    })
    const activeId = spawnedChildId(activeSpawn)
    await waitRunning(activeSetup.ctx, activeId)
    const controller = new AbortController()
    const waiting = execute(activeSetup.ctx, activeSetup.lead, 'wait_agent', { timeout_ms: 10_000 }, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 0))
    controller.abort({ kind: 'user' })
    const aborted = await waiting
    expect(aborted.isError).toBe(true)
    expect(text(aborted)).toBe("Error: wait_agent aborted: { kind: 'user' }")
    await execute(activeSetup.ctx, activeSetup.lead, 'interrupt_agent', { target: 'active-worker' })
    await waitNoAgent(activeSetup.ctx, activeId)
  })

  it('rejects a teammate result claim until the assigned external action has a real receipt', async () => {
    const { ctx, lead } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'mail-worker',
      description: 'send a real test email',
      prompt: 'Envía un correo de prueba por Gmail y confirma solo después del envío real.',
    })
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)

    const theatrical = await execute(ctx, child, 'send_message', {
      target: 'lead',
      purpose: 'result',
      message: 'Correo enviado correctamente.',
    })
    expect(theatrical.isError).toBe(true)
    expect(text(theatrical)).toContain('no successful non-Team tool receipt')

    const callId = CallId('real-gmail-send')
    child.session.append('tool/call', {
      turn: 1,
      step: 2,
      callId,
      name: 'mcp__Gmail__send_email',
      arguments: '{"to":"test@example.com"}',
    })
    child.session.append('tool/result', {
      turn: 1,
      step: 2,
      message: createToolResultMessage({
        callId,
        content: [{ type: 'text', text: 'sent' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })

    const proven = await execute(ctx, child, 'send_message', {
      target: 'lead',
      purpose: 'result',
      message: 'Correo enviado correctamente.',
    })
    expect(proven.isError).toBe(false)
    const team = await ctx.agentTeams.chatMessages({ sessionId: lead.id })
    expect(team.messages.some(message =>
      message.text.includes('Correo enviado correctamente.')
      && message.text.includes('✓ Evidencia ejecutada: send_email'))).toBe(true)

    await execute(ctx, lead, 'interrupt_agent', { target: 'mail-worker' })
    await waitNoAgent(ctx, childId)
  })

  it('reads bounded conversation context and applies optional visible reactions through the actual child tools', async () => {
    const { ctx, lead } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'chat-worker', description: 'Discuss the approach.', prompt: 'Discuss the approach.', context: 'fresh',
    })
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)
    await ctx.agentTeams.chatReply({ requestId: 'visible-chat-question', sessionId: lead.id, targetId: childId, text: 'Why this approach?' })
    const recent = await execute(ctx, child, 'team_chat_read', {})
    expect(recent.isError).toBe(false)
    const recentParsed = JSON.parse(text(recent)) as { messages: unknown[] }
    expect(recentParsed.messages).toContainEqual({ id: 'visible-chat-question', sender: 'User', text: 'Why this approach?' })
    const limited = await execute(ctx, child, 'team_chat_read', { limit: 1 })
    expect(JSON.parse(text(limited))).toMatchObject({ messages: [
      { id: 'visible-chat-question', sender: 'User', text: 'Why this approach?' },
    ] })
    for (const limit of [0, 51]) {
      const invalid = await execute(ctx, child, 'team_chat_read', { limit })
      expect(invalid.isError).toBe(true)
      expect(text(invalid)).toContain('limit must be between')
    }
    const reaction = await execute(ctx, child, 'team_chat_react', { message_id: 'visible-chat-question', emoji: '👍' })
    expect(reaction.isError).toBe(false)
    expect(JSON.parse(text(reaction))).toEqual({ applied: true })
    const removed = await execute(ctx, child, 'team_chat_react', { message_id: 'visible-chat-question', emoji: '👍', active: false })
    expect(removed.isError).toBe(false)
    expect((await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages.find(row => row.id === 'visible-chat-question')?.reactions).toEqual([])
    const rootRead = await execute(ctx, lead, 'team_chat_read', { limit: 1 })
    expect(rootRead.isError).toBe(false)
    child.cancel({ kind: 'user' })
    await waitNoAgent(ctx, child.id)
    lead.cancel({ kind: 'user' })
    await lead.whenIdle()
  })

  it('adapts roster, mailbox, wait, and task CAS operations to canonical JSON', async () => {
    const { ctx, lead } = await setup(['hang', textResponse('lead received wakeup')])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'json-worker', description: 'json worker', prompt: 'wait', context: 'fresh',
    })
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)

    const roster = await execute(ctx, child, 'list_agents', {})
    expect(JSON.parse(text(roster))).toMatchObject([
      { name: 'lead', role: 'lead' },
      { name: 'json-worker', role: 'teammate' },
    ])
    // Every Team result reaches the model as compact JSON: indentation would
    // spend tokens on every roster, task, and receipt without adding meaning.
    expect(text(roster)).toBe(JSON.stringify(JSON.parse(text(roster))))
    const peer = await execute(ctx, child, 'send_message', {
      target: 'lead', purpose: 'result', message: 'quiet report',
    })
    expect(peer.isError).toBe(false)
    expect(JSON.parse(text(peer))).toMatchObject({ status: 'accepted' })
    const peerReceipt = JSON.parse(text(peer)) as { messageId: string }
    const reacted = await execute(ctx, lead, 'team_react', {
      message_id: peerReceipt.messageId,
      reaction: 'ack',
    })
    expect(reacted.isError).toBe(false)
    expect(JSON.parse(text(reacted))).toMatchObject({
      messageId: peerReceipt.messageId,
      reactorName: 'lead',
      reaction: 'ack',
    })
    const duplicateReaction = await execute(ctx, lead, 'team_react', {
      message_id: peerReceipt.messageId,
      reaction: 'agree',
    })
    expect(duplicateReaction.isError).toBe(true)
    expect(text(duplicateReaction)).toContain('only once')
    const waking = await execute(ctx, child, 'followup_task', {
      target: 'lead', purpose: 'review', message: 'review the report',
    })
    expect(waking.isError).toBe(false)
    expect(JSON.parse(text(waking))).toMatchObject({ status: 'accepted' })
    await lead.whenIdle()

    const created = await execute(ctx, lead, 'team_task_create', {
      subject: 'tool task',
      description: 'created through tool',
      blocked_by: [],
      write_scopes: ['src/team'],
    })
    const task = JSON.parse(text(created)) as { id: string; revision: number }
    const listed = await execute(ctx, child, 'team_task_list', { ready: true, limit: 1 })
    expect(JSON.parse(text(listed))).toMatchObject({ tasks: [{ id: task.id, ready: true }] })
    const read = await execute(ctx, child, 'team_task_get', { task_id: task.id })
    expect(JSON.parse(text(read))).toMatchObject({ id: task.id, revision: 1 })
    const claimed = await execute(ctx, child, 'team_task_update', {
      task_id: task.id,
      expected_revision: task.revision,
      action: 'claim',
    })
    expect(JSON.parse(text(claimed))).toMatchObject({ status: 'in_progress', ownerName: 'json-worker' })
    const stale = await execute(ctx, lead, 'team_task_update', {
      task_id: task.id,
      expected_revision: task.revision,
      action: 'delete',
    })
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('stale team task')

    const wait = execute(ctx, lead, 'wait_agent', { timeout_ms: 10_000 })
    const completedCall = new Promise<Awaited<ReturnType<typeof execute>>>((resolve, reject) => {
      setTimeout(() => {
        void execute(ctx, child, 'team_task_update', {
          task_id: task.id,
          expected_revision: 2,
          action: 'complete',
        }).then(resolve, reject)
      }, 0)
    })
    await expect(wait).resolves.toMatchObject({ isError: false })
    expect((await completedCall).isError).toBe(false)

    const childInterrupt = await execute(ctx, child, 'interrupt_agent', { target: 'json-worker' })
    expect(childInterrupt.isError).toBe(true)
    await execute(ctx, lead, 'interrupt_agent', { target: 'json-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('adapts optional task filters, mutations, pagination, and default waiting', async () => {
    const { ctx, lead } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'fork-worker', description: 'fork worker', prompt: 'stay active', context: 'fork',
    })
    const childId = spawnedChildId(spawned)
    await waitRunning(ctx, childId)

    const firstResult = await execute(ctx, lead, 'team_task_create', {
      subject: 'first', description: 'first task',
    })
    const secondResult = await execute(ctx, lead, 'team_task_create', {
      subject: 'second', description: 'second task',
    })
    const first = JSON.parse(text(firstResult)) as { id: string; revision: number }
    const second = JSON.parse(text(secondResult)) as { id: string; revision: number }
    const claimed = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id, expected_revision: first.revision, action: 'claim',
    })
    const claim = JSON.parse(text(claimed)) as { revision: number }

    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      status: 'in_progress', owner: 'lead', cursor: 0, limit: 1,
    })))).toMatchObject({ tasks: [{ id: first.id }] })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      owner: 'unowned', limit: 1,
    })))).toMatchObject({ tasks: [{ id: second.id }] })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      cursor: 0, limit: 1,
    })))).toMatchObject({ nextCursor: 1 })
    expect(JSON.parse(text(await execute(ctx, lead, 'team_task_list', {
      cursor: 1,
    })))).not.toHaveProperty('nextCursor')
    expect((await execute(ctx, lead, 'team_task_list', { cursor: -1 })).isError).toBe(true)
    expect((await execute(ctx, lead, 'team_task_list', { limit: 101 })).isError).toBe(true)

    const edited = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: claim.revision,
      action: 'edit',
      subject: 'edited',
      description: 'edited description',
      write_scopes: ['src/team'],
    })
    const edit = JSON.parse(text(edited)) as { revision: number }
    const dependencies = await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: edit.revision,
      action: 'set_dependencies',
      blocked_by: [second.id],
    })
    expect(dependencies.isError).toBe(false)
    const dependency = JSON.parse(text(dependencies)) as { revision: number }
    expect((await execute(ctx, lead, 'team_task_update', {
      task_id: first.id,
      expected_revision: dependency.revision,
      action: 'reassign',
      owner: 'fork-worker',
    })).isError).toBe(true)

    const wait = execute(ctx, lead, 'wait_agent', {})
    const wake = new Promise<Awaited<ReturnType<typeof execute>>>((resolve, reject) => {
      setTimeout(() => {
        void execute(ctx, lead, 'team_task_create', {
          subject: 'wake', description: 'wake default wait',
        }).then(resolve, reject)
      }, 0)
    })
    expect((await wait).isError).toBe(false)
    expect((await wake).isError).toBe(false)

    await execute(ctx, lead, 'interrupt_agent', { target: 'fork-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('removes and reinstalls every scoped registration across plugin HMR without stopping the child', async () => {
    const { ctx, lead, fiber } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'hmr-worker', description: 'hmr worker', prompt: 'wait',
    })
    const childId = spawnedChildId(spawned)
    const child = await waitRunning(ctx, childId)

    await fiber.dispose()
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).some(name => TOOL_NAMES.includes(name))).toBe(false)
    expect((await assembly(ctx, child)).tools.map(schema => schema.name).some(name => TOOL_NAMES.includes(name))).toBe(false)
    expect(ctx.agents.get(childId)).toBe(child)

    const replacement = await ctx.plugin(toolTeam)
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    expect((await assembly(ctx, child)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    await execute(ctx, lead, 'interrupt_agent', { target: 'hmr-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
    await replacement.dispose()
  })

  it('shadows legacy global control names only inside Team member scopes', async () => {
    const { ctx, lead, fiber } = await setup([], true)
    const teamSchema = (await assembly(ctx, lead)).tools.find(schema => schema.name === 'send_message')
    expect(JSON.stringify(teamSchema)).toContain('target')
    expect(JSON.stringify(teamSchema)).toContain('purpose')
    expect(JSON.stringify(teamSchema)).not.toContain('subagent_id')

    await fiber.dispose()
    const legacySchema = (await assembly(ctx, lead)).tools.find(schema => schema.name === 'send_message')
    expect(JSON.stringify(legacySchema)).toContain('subagent_id')
  })

  it('rolls back partial scoped installation after a same-scope collision', async () => {
    const { ctx, lead, fiber } = await setup([])
    await fiber.dispose()
    lead.ctx.tools.register(defineContentToolFixture({
      name: 'spawn_teammate',
      description: 'intentional collision',
      parameters: {},
      async execute() { return [{ type: 'text', text: 'collision' }] },
    }))

    await expect(ctx.plugin(toolTeam)).rejects.toThrow(/already registered/u)
    const assembled = await assembly(ctx, lead)
    expect(assembled.tools.filter(schema => TOOL_NAMES.includes(schema.name)).map(schema => schema.name))
      .toEqual(['spawn_teammate'])
    expect(renderPrompt(assembled)).not.toContain('Your Team role is lead')
  })

  it('resolves direct-apply defaults without Loader schema normalization', async () => {
    const { ctx, lead, fiber } = await setup([textResponse('ordinary child')])
    await fiber.dispose()
    toolTeam.apply(ctx, {})
    expect((await assembly(ctx, lead)).tools.map(schema => schema.name).filter(name => TOOL_NAMES.includes(name)).sort())
      .toEqual(TOOL_NAMES)
    const ordinary = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'ordinary child',
      request: { prompt: [{ type: 'text', text: 'finish' }], parent: lead },
      signal: SIGNAL,
    })
    await vi.waitFor(() => { expect(ctx.agents.get(ordinary.childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('reinstalls Team scope before a cold-resumed teammate request', async () => {
    const { ctx, lead } = await setup([textResponse('first'), 'hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', {
      name: 'cold-worker', description: 'cold worker', prompt: 'finish once',
    })
    const childId = spawnedChildId(spawned)
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })

    await ctx.agentTeams.sendMessage(lead, {
      target: 'cold-worker',
      content: [{ type: 'text', text: 'resume with Team scope' }],
      delivery: 'wakeup',
      signal: SIGNAL,
    })
    const resumed = await waitRunning(ctx, childId)
    expect((await assembly(ctx, resumed)).tools.map(schema => schema.name)
      .filter(name => TOOL_NAMES.includes(name)).sort()).toEqual(TOOL_NAMES)
    expect(renderPrompt(await assembly(ctx, resumed))).toContain('Your Team role is teammate; your Team name is cold-worker')
    await execute(ctx, lead, 'interrupt_agent', { target: 'cold-worker' })
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
  })

  it('fails safely without a calling Agent and has the function-plugin export shape', async () => {
    const { ctx } = await setup([])
    const result = await execute(ctx, undefined, 'list_agents', {})
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unknown tool "list_agents"')
    expect('default' in toolTeam).toBe(false)
    expect(toolTeam.name).toBe('tool-agent-team')
    expect(toolTeam.inject).toEqual(['agents', 'agentTeams', 'tools', 'systemPrompt'])
  })

  it('uses configured fresh and fork provider names', async () => {
    const { ctx, lead, fiber } = await setup([textResponse('custom')])
    await fiber.dispose()
    await ctx.plugin(SubagentSpawn, { providerName: 'team-fresh' })
    await ctx.plugin(toolTeam, { freshProvider: 'team-fresh', forkProvider: 'fork' })
    const result = await execute(ctx, lead, 'spawn_teammate', {
      name: 'custom-provider', description: 'custom provider', prompt: 'go',
    })
    expect(result.isError).toBe(false)
    const childId = spawnedChildId(result)
    await vi.waitFor(() => { expect(ctx.agents.get(childId)).toBeUndefined() }, { timeout: 5_000 })
    expect(ctx.agentTeams.listMembers(lead)[1]).toMatchObject({ provider: 'team-fresh' })
  })
})
