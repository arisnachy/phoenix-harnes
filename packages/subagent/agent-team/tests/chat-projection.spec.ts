import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@phoenix-ai/cordis'
import SessionStore, { SessionId } from '@phoenix-ai/dsh-session'
import SessionProjectionRegistry from '@phoenix-ai/dsh-session-projection'
import type { ProjectionCheckpoint } from '@phoenix-ai/dsh-session-projection'
import { TeamId, TeamMessageId } from '../src/types.ts'
import type { TeamChatReaction } from '../src/chat-types.ts'
import { teamChatReactionsDefinition } from '../src/chat-projection.ts'

describe('team chat reaction projection', () => {
  it('replays historical semantic reactions when restoring a persisted pre-upgrade checkpoint', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const fiber = await ctx.plugin(SessionProjectionRegistry)
    const storage = await mkdtemp(join(tmpdir(), 'phoenix-reaction-checkpoint-'))
    try {
      const session = ctx.sessions.create()
      const queued = session.append('team/message/queued', {
        version: 1, teamId: TeamId(session.id),
        message: { id: TeamMessageId('historical-result'), senderId: SessionId('worker'), senderName: 'worker',
          targetId: session.id, delivery: 'quiet', content: [{ type: 'text', text: 'Verified result' }] },
      })
      const event = session.append('team/reaction', {
        version: 1, teamId: TeamId(session.id),
        reaction: { messageId: TeamMessageId('historical-result'), reactorId: session.id, reactorName: 'lead', reaction: 'done' },
      })
      // Version 1 checkpointed an empty stream because semantic reactions were rendered separately.
      const path = join(storage, 'projection.json')
      await writeFile(path, JSON.stringify({ teamChatReactions: { ver: 1, seq: event.seq, val: {} } }))
      const persisted: unknown = JSON.parse(await readFile(path, 'utf8'))
      const checkpoint = persisted as ProjectionCheckpoint
      ctx.sessionProjections.register(teamChatReactionsDefinition)
      const floor = ctx.sessionProjections.restoreFloor(checkpoint)!
      const restored = ctx.sessionProjections.restore(checkpoint, [queued, event].filter(item => item.seq >= floor), floor)
      expect(restored.snapshot.values.teamChatReactions?.['historical-result']).toMatchObject([
        { reactorId: session.id, reactorKind: 'kira', emoji: '✅' },
      ])
      expect(restored.checkpoint.teamChatReactions?.ver).toBe(2)
      expect(ctx.sessionProjections.restoreFloor(restored.checkpoint)).toBe(event.seq)
      const repeated = ctx.sessionProjections.restore(restored.checkpoint, [event], event.seq)
      expect(repeated.snapshot.values.teamChatReactions).toEqual(restored.snapshot.values.teamChatReactions)
    } finally {
      await fiber.dispose()
      await rm(storage, { recursive: true, force: true })
    }
  })
  it('maps legacy semantic Kira reactions into the canonical visible emoji stream', () => {
    const state: Record<string, TeamChatReaction[]> = {}
    const next = teamChatReactionsDefinition.apply(state, {
      type: 'team/reaction',
      seq: 7,
      time: 123,
      data: {
        version: 1,
        teamId: 'root',
        reaction: {
          messageId: 'message-1',
          reactorId: 'root',
          reactorName: 'lead',
          reaction: 'ack',
        },
      },
    } as never)

    expect(next['message-1']).toEqual([{
      id: 'legacy:message-1:root',
      messageId: 'message-1',
      reactorId: 'root',
      reactorName: 'lead',
      reactorKind: 'kira',
      emoji: '👍',
      createdAt: 123,
    }])
  })

  it('maps legacy teammate reactions to their own avatar-bearing actor identity', () => {
    const state: Record<string, TeamChatReaction[]> = {}
    const next = teamChatReactionsDefinition.apply(state, {
      type: 'team/reaction',
      seq: 8,
      time: 456,
      data: {
        version: 1,
        teamId: 'root',
        reaction: {
          messageId: 'message-2',
          reactorId: 'worker-a',
          reactorName: 'la-forja',
          reaction: 'done',
        },
      },
    } as never)

    expect(next['message-2']?.[0]).toMatchObject({
      reactorId: 'worker-a',
      reactorKind: 'agent',
      emoji: '✅',
    })
  })
})
