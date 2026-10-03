import { describe, expect, it } from 'vitest'
import { teamChatReactionsDefinition } from '../src/chat-projection.ts'

describe('team chat reaction projection', () => {
  it('maps legacy semantic Kira reactions into the canonical visible emoji stream', () => {
    const state = teamChatReactionsDefinition.init()
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
    const state = teamChatReactionsDefinition.init()
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
