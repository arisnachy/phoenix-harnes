import { describe, expect, it, vi } from 'vitest'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { setup, waitNoAgent, SIGNAL } from '../../tool-agent-team/tests/team-lifecycle-fixture.ts'

describe('Team mailbox worker-route inheritance', () => {
  it('resumes a persisted worker without imposing a missing Lead route', async () => {
    const { ctx, lead } = await setup([textResponse('first'), textResponse('followup')])
    const worker = await ctx.agentTeams.spawnTeammate(lead, { name: 'persisted', description: 'work', prompt: [{ type: 'text', text: 'finish' }], context: 'fresh', provider: 'spawn', signal: SIGNAL })
    await waitNoAgent(ctx, worker.member.id)
    delete lead.options.provider
    delete lead.options.model
    const followup = vi.spyOn(ctx.subagents, 'followup')
    const result = await ctx.agentTeams.sendMessage(lead, { target: 'persisted', purpose: 'assignment', content: [{ type: 'text', text: 'continue' }], delivery: 'wakeup', signal: SIGNAL })
    expect(result.status).toBe('accepted')
    expect(followup).toHaveBeenCalledOnce()
    expect(followup.mock.calls[0]?.[0]).toBe(lead)
    expect(followup.mock.calls[0]?.[1]).toBe(worker.member.id)
    expect(followup.mock.calls[0]?.[3]).not.toHaveProperty('modelSelection')
    await waitNoAgent(ctx, worker.member.id)
    const loaded = await ctx.sessionPersistence.inspect(worker.member.id)
    expect(loaded.events.some(event => event.type === 'user/message' && event.data.source.kind === 'team-message' && event.data.source.messageId === result.messageId)).toBe(true)
  })
})
