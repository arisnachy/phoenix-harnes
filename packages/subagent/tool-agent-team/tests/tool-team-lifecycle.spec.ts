import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@phoenix-ai/dsh-session'
import { ReasoningEffortId } from '@phoenix-ai/dsh-llm'
import { defineContentToolFixture } from '@phoenix-ai/dsh-tools'
import { renderPrompt } from '@phoenix-ai/dsh-system-prompt'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as toolTeam from '../src/index.ts'
import { setup, execute, spawnedChildId, assembly, waitRunning, waitNoAgent, text, SIGNAL } from './team-lifecycle-fixture.ts'

describe('Team tool routing and installation lifecycle', () => {
  it('keeps Codex inheritance when a configured default belongs to another provider', async () => {
    const { ctx, lead } = await setup(['hang'], false, {
      defaultModelProfile: 'foreign', modelProfiles: { foreign: { provider: 'mock', model: 'foreign' } },
    })
    ctx.llm.registerAdapter(['openai-codex'], new MockAdapter(['hang']))
    lead.options.provider = 'openai-codex'
    lead.options.model = 'selected'
    const result = await execute(ctx, lead, 'spawn_teammate', { name: 'inherit', description: 'inherit', prompt: 'wait' })
    expect(result.isError).toBe(false)
    const child = await waitRunning(ctx, spawnedChildId(result))
    expect(child.options).toMatchObject({ provider: 'openai-codex', model: 'selected' })
    await execute(ctx, lead, 'interrupt_agent', { target: 'inherit' })
    await waitNoAgent(ctx, child.id)
  })

  it('uses optional token limits from a chosen Codex profile without inventing reasoning effort', async () => {
    const { ctx, lead } = await setup([], false, { modelProfiles: { bounded: { provider: 'openai-codex', model: 'worker', maxTokens: 512 } } })
    ctx.llm.registerAdapter(['openai-codex'], new MockAdapter(['hang']))
    lead.options.provider = 'openai-codex'
    lead.options.model = 'planner'
    const result = await execute(ctx, lead, 'spawn_teammate', { name: 'bounded', description: 'bounded', prompt: 'wait', model_profile: 'bounded' })
    const child = await waitRunning(ctx, spawnedChildId(result))
    expect(child.options).toMatchObject({ provider: 'openai-codex', model: 'worker', maxTokens: 512 })
    expect(child.options.reasoningEffort).toBeUndefined()
    await execute(ctx, lead, 'interrupt_agent', { target: 'bounded' })
    await waitNoAgent(ctx, child.id)
  })

  it('inherits live non-Codex request token and reasoning settings together', async () => {
    const { ctx, lead } = await setup(['hang'], false, {}, { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] })
    lead.session.append('turn/start', { turn: 1 })
    lead.session.append('request/header', { reason: 'initial', header: { config: { provider: 'mock', model: 'mock', maxTokens: 1024, reasoningEffort: ReasoningEffortId('high') } } })
    const result = await execute(ctx, lead, 'spawn_teammate', { name: 'inherited', description: 'inherit', prompt: 'wait' })
    const child = await waitRunning(ctx, spawnedChildId(result))
    expect(child.options).toMatchObject({ provider: 'mock', model: 'mock', maxTokens: 1024, reasoningEffort: 'high' })
    await execute(ctx, lead, 'interrupt_agent', { target: 'inherited' })
    await waitNoAgent(ctx, child.id)
  })

  it('leaves default-route resolution to the provider for a Lead without a configured model', async () => {
    const { ctx, lead } = await setup([textResponse('resolved default')])
    delete lead.options.model
    const spawn = vi.spyOn(ctx.agentTeams, 'spawnTeammate')
    const result = await execute(ctx, lead, 'spawn_teammate', { name: 'unconfigured', description: 'default route', prompt: 'finish' })
    expect(result.isError).toBe(false)
    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn.mock.calls[0]?.[1]).not.toHaveProperty('agentOptions')
    await waitNoAgent(ctx, spawnedChildId(result))
  })

  it('records ongoing teammate updates without requiring a completion receipt', async () => {
    const { ctx, lead } = await setup(['hang'])
    const spawned = await execute(ctx, lead, 'spawn_teammate', { name: 'worker', description: 'work', prompt: 'Create a file.' })
    const child = await waitRunning(ctx, spawnedChildId(spawned))
    const update = await execute(ctx, child, 'send_message', { target: 'lead', purpose: 'update', message: 'Still investigating the available paths.' })
    expect(update.isError).toBe(false)
    expect(lead.session.events.some(event => event.type === 'team/message/queued' && event.data.message.content.some(block => block.type === 'text' && block.text === 'Still investigating the available paths.'))).toBe(true)
    await execute(ctx, lead, 'interrupt_agent', { target: 'worker' })
    await waitNoAgent(ctx, child.id)
  })

  it('supports visible reactions by the Lead in its own root conversation', async () => {
    const { ctx, lead } = await setup([])
    lead.session.append('team/chat-message', { version: 1, message: {
      id: 'user-question', senderId: 'user', senderName: 'User', senderKind: 'user', missionId: lead.id,
      text: 'Question', time: 1, sourceSeq: 0, mentions: [], reactions: [],
    } })
    const result = await execute(ctx, lead, 'team_chat_react', { message_id: 'user-question', emoji: '👍' })
    expect(result.isError).toBe(false)
    const messages = (await ctx.agentTeams.chatMessages({ sessionId: lead.id })).messages
    expect(messages.find(row => row.id === 'user-question')?.reactions).toHaveLength(1)
  })

  it('rolls back conversation tools and prompts after a chat-tool registration collision', async () => {
    const { ctx, lead, fiber } = await setup([])
    await fiber.dispose()
    const collision = lead.ctx.tools.register(defineContentToolFixture({ name: 'team_chat_answer', description: 'owned separately', parameters: {}, async execute() { return [] } }))
    await expect(ctx.plugin(toolTeam)).rejects.toThrow(/already registered/u)
    const rolledBack = await assembly(ctx, lead)
    expect(rolledBack.tools.map(tool => tool.name)).not.toContain('team_chat_read')
    expect(renderPrompt(rolledBack)).not.toContain('Your real operational text appears')
    collision()
    const replacement = await ctx.plugin(toolTeam)
    expect((await assembly(ctx, lead)).tools.map(tool => tool.name)).toContain('team_chat_read')
    await replacement.dispose()
    expect((await assembly(ctx, lead)).tools.map(tool => tool.name)).not.toContain('team_chat_read')
  })

  it('does not reinstall an already published Agent or attach chat tools to orphan children', async () => {
    const { ctx, lead } = await setup([textResponse('ordinary')])
    const started = await ctx.subagents.startContinuable({ provider: 'spawn', label: 'ordinary', request: { parent: lead, prompt: [{ type: 'text', text: 'finish' }] }, signal: SIGNAL })
    await waitNoAgent(ctx, started.childId)
    const stored = await ctx.sessionPersistence.inspect(started.childId)
    const seed = stored.events.filter(event => event.type === 'subagent/descriptor')
    ctx.emit('agent/created', { agent: lead })
    expect((await assembly(ctx, lead)).tools.filter(tool => tool.name === 'team_chat_read')).toHaveLength(1)
    for (const parentSession of [undefined, SessionId('missing')]) {
      const orphan = await ctx.agents.create({ sessionId: SessionId(`orphan-${parentSession ?? 'none'}`), seed, meta: { origin: 'subagent', ...parentSession === undefined ? {} : { parentSession } }, agentOptions: {} })
      expect((await assembly(ctx, orphan.agent)).tools.map(tool => tool.name)).not.toContain('team_chat_read')
      if (parentSession === undefined) {
        const reaction = ctx.tools.get('team_chat_react', lead)
        if (reaction === undefined) throw new Error('missing installed reaction')
        const dispose = lead.ctx.tools.register(defineContentToolFixture({
          name: 'invoke_detached_reaction', description: 'Invoke a captured reaction for a detached child', parameters: {},
          async execute(_args, execution) {
            await reaction.execute({ message_id: 'unowned', emoji: '👍' }, { ...execution, agent: orphan.agent })
            return []
          },
        }))
        const rejected = await execute(ctx, lead, 'invoke_detached_reaction', {})
        expect(rejected.isError).toBe(true)
        expect(text(rejected)).toContain('team root not found')
        dispose()
      }
      await orphan.dispose()
    }
  })
})
