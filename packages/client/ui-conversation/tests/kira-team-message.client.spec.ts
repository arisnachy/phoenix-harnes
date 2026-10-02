import { Context } from '@phoenix-ai/cordis'
import { ConversationNodeAssembler } from '../../runtime/src/client/sessions/conversation-assembler.ts'
import { ConversationEventRegistry } from '../../runtime/src/client/conversation/event-registry.ts'
import { ConversationViewRegistry } from '../../runtime/src/client/conversation/view-registry.ts'
import { describe, expect, it } from 'vitest'
import type {
  ConversationMatch, ConversationNodeContext,
} from '@phoenix-ai/dsh-client-runtime/client'
import {
  kiraTeamMessageDefinition,
} from '../src/client/conversation-nodes/kira-team-message.ts'
import type {
  KiraTeamMessageChatData,
} from '../src/client/contract/chat-nodes.ts'

function event(type: string, data: unknown, seq = 1) {
  return { seq, time: 1_700_000_000_000 + seq, type, data } as never
}

function match(
  type: string,
  data: unknown,
  seq = 1,
  location?: unknown,
): ConversationMatch {
  return {
    event: event(type, data, seq),
    view: undefined,
    role: 'start',
    location,
  } as unknown as ConversationMatch
}

function context(
  state: KiraTeamMessageChatData | undefined,
  matches: ConversationMatch[] = [],
  start?: ConversationMatch,
): ConversationNodeContext<KiraTeamMessageChatData> {
  return {
    key: 'team:k',
    kind: 'kira-team-message',
    id: 'message-1',
    matches,
    start,
    state,
    current: new Map(),
  }
}

function stateContext(
  state: KiraTeamMessageChatData,
): ConversationNodeContext<KiraTeamMessageChatData> & { readonly state: KiraTeamMessageChatData } {
  return { ...context(state), state }
}

const queuedData = {
  version: 1,
  teamId: 'root',
  message: {
    id: 'message-1',
    senderId: 'worker-a',
    senderName: 'la-forja',
    targetId: 'root',
    targetName: 'lead',
    purpose: 'blocker',
    content: [{ type: 'text', text: 'Necesito una decisión.' }],
  },
}

describe('KIRA Team conversation node', () => {
  it('projects an active real teammate as Kira\'s visible assignment in chat', () => {
    const provisioning = event('team/member', {
      version: 1,
      teamId: 'root',
      member: {
        id: 'worker-a',
        name: 'la-forja',
        description: 'Revisar el flujo de delegación.',
        provider: 'spawn',
        context: 'fresh',
        phase: 'provisioning',
      },
    })
    expect(kiraTeamMessageDefinition.match(provisioning)).toBeNull()

    const active = match('team/member', {
      version: 1,
      teamId: 'root',
      member: {
        id: 'worker-a',
        name: 'la-forja',
        description: 'Revisar el flujo de delegación.',
        provider: 'spawn',
        context: 'fresh',
        phase: 'active',
      },
    }, 7, { kind: 'turn', turn: 1 })
    expect(kiraTeamMessageDefinition.match(active.event)).toEqual({
      id: 'team-member:worker-a',
      role: 'start',
    })

    const state = kiraTeamMessageDefinition.start(context(undefined), active, {} as never)
    expect(state).toMatchObject({
      messageId: 'team-member:worker-a',
      senderId: 'root',
      senderName: 'lead',
      targetId: 'worker-a',
      targetName: 'la-forja',
      purpose: 'assignment',
      content: [{ type: 'text', text: 'Revisar el flujo de delegación.' }],
      seq: 7,
      reactions: [],
    })
    expect(kiraTeamMessageDefinition.buildViewNode?.(context(state, [active], active))).toMatchObject({
      kind: 'kira-team-message',
      id: 'message-1',
      anchorSeq: 7,
      location: { kind: 'turn', turn: 1 },
      data: state,
    })
  })

  it('projects one durable peer message and folds real reactions onto the same chat row', () => {
    expect(kiraTeamMessageDefinition.match(event('team/message/queued', queuedData))).toEqual({
      id: 'message-1',
      role: 'start',
    })

    const start = match('team/message/queued', queuedData, 10, { kind: 'turn', turn: 2 })
    const state = kiraTeamMessageDefinition.start(context(undefined), start, {} as never)
    expect(state).toMatchObject({
      messageId: 'message-1',
      senderName: 'la-forja',
      targetName: 'lead',
      purpose: 'blocker',
      seq: 10,
      reactions: [],
    })

    const reaction = match('team/reaction', {
      version: 1,
      teamId: 'root',
      reaction: {
        messageId: 'message-1',
        reactorId: 'root',
        reactorName: 'lead',
        reaction: 'ack',
      },
    }, 11)
    expect(kiraTeamMessageDefinition.match(reaction.event)).toEqual({
      id: 'message-1',
      role: 'update',
    })
    const reacted = kiraTeamMessageDefinition.update(stateContext(state), reaction)
    expect(reacted.reactions).toEqual([{
      reactorId: 'root',
      reactorName: 'lead',
      reaction: 'ack',
    }])

    expect(kiraTeamMessageDefinition.update(stateContext(reacted), reaction)).toBe(reacted)
    expect(kiraTeamMessageDefinition.update(stateContext(reacted), match('team/reaction', {
      version: 1,
      reaction: {
        messageId: 'another-message',
        reactorId: 'worker-b',
        reactorName: 'argo',
        reaction: 'done',
      },
    }))).toBe(reacted)
    expect(kiraTeamMessageDefinition.update(stateContext(reacted), match('other', {}))).toBe(reacted)

    const view = kiraTeamMessageDefinition.buildViewNode?.(context(reacted, [start], start))
    expect(view).toMatchObject({
      key: 'team:k',
      kind: 'kira-team-message',
      id: 'message-1',
      target: 'chat',
      anchorSeq: 10,
      location: { kind: 'turn', turn: 2 },
      visibility: 'visible',
      data: reacted,
    })
    expect(kiraTeamMessageDefinition.buildViewNode?.(context(undefined))).toBeNull()
  })

  it('keeps optional recipient and purpose backward-compatible and resolves location fallbacks', () => {
    const legacy = match('team/message/queued', {
      version: 1,
      message: {
        id: 'message-1',
        senderId: 'worker-a',
        senderName: 'la-forja',
        targetId: 'root',
        content: [],
      },
    }, 20, { kind: 'step', turn: 3, step: 1 })
    const state = kiraTeamMessageDefinition.start(context(undefined), legacy, {} as never)
    expect(state.targetName).toBeUndefined()
    expect(state.purpose).toBeUndefined()

    const fromMatch = kiraTeamMessageDefinition.buildViewNode?.(context(state, [legacy]))
    expect(fromMatch).toMatchObject({ location: { kind: 'step', turn: 3, step: 1 } })
    const unresolved = kiraTeamMessageDefinition.buildViewNode?.(context(state))
    expect(unresolved).toMatchObject({ location: { kind: 'unresolved' } })

    const invalidPurpose = kiraTeamMessageDefinition.start(context(undefined), match('team/message/queued', {
      version: 1,
      message: {
        id: 'message-1',
        senderId: 'worker-a',
        senderName: 'la-forja',
        targetId: 'root',
        purpose: 'chatty-filler',
        content: [],
      },
    }), {} as never)
    expect(invalidPurpose.purpose).toBeUndefined()
  })

  it('rejects malformed plugin events instead of synthesizing chat rows', () => {
    expect(kiraTeamMessageDefinition.match(event('other', {}))).toBeNull()
    expect(kiraTeamMessageDefinition.match(event('team/message/queued', { version: 1, message: {} }))).toBeNull()
    expect(kiraTeamMessageDefinition.match(event('team/reaction', { version: 1, reaction: {} }))).toBeNull()
    expect(kiraTeamMessageDefinition.match(event('team/member', {
      version: 1,
      teamId: 'root',
      member: { id: 'worker-a', phase: 'active' },
    }))).toBeNull()

    const malformedQueued = [
      null,
      [],
      { version: 0, message: queuedData.message },
      { version: 1, message: null },
      { version: 1, message: { ...queuedData.message, id: undefined } },
      { version: 1, message: { ...queuedData.message, senderId: undefined } },
      { version: 1, message: { ...queuedData.message, senderName: undefined } },
      { version: 1, message: { ...queuedData.message, targetId: undefined } },
      { version: 1, message: { ...queuedData.message, content: 'not-an-array' } },
    ]
    for (const data of malformedQueued) {
      expect(() => kiraTeamMessageDefinition.start(
        context(undefined),
        match('team/message/queued', data),
        {} as never,
      )).toThrow('kira-team-message start requires a valid team/message/queued event')
    }
    expect(() => kiraTeamMessageDefinition.start(
      context(undefined),
      match('other', {}),
      {} as never,
    )).toThrow('kira-team-message start requires a valid team/message/queued event')

    const baseState = kiraTeamMessageDefinition.start(
      context(undefined),
      match('team/message/queued', queuedData),
      {} as never,
    )
    const malformedReactions = [
      null,
      [],
      { version: 0, reaction: { messageId: 'message-1' } },
      { version: 1, reaction: null },
      { version: 1, reaction: { messageId: undefined, reactorId: 'r', reactorName: 'R', reaction: 'ack' } },
      { version: 1, reaction: { messageId: 'message-1', reactorId: undefined, reactorName: 'R', reaction: 'ack' } },
      { version: 1, reaction: { messageId: 'message-1', reactorId: 'r', reactorName: undefined, reaction: 'ack' } },
      { version: 1, reaction: { messageId: 'message-1', reactorId: 'r', reactorName: 'R', reaction: 'party' } },
    ]
    for (const data of malformedReactions) {
      expect(kiraTeamMessageDefinition.update(
        stateContext(baseState),
        match('team/reaction', data),
      )).toBe(baseState)
    }
  })
})

// Use the actual assembler because repeated durable snapshots are not separate messages.
it('assembles one human reply through per-target receipts, supervision and full replay', () => {
  const ctx = new Context()
  const events = new ConversationEventRegistry(ctx)
  const views = new ConversationViewRegistry(ctx)
  events.register(kiraTeamMessageDefinition)
  views.register({ target: 'chat', create: () => ({ empty: [], replace: ({ nodes }) => nodes,
    apply: ({ upserts }) => upserts }) })
  const assembler = new ConversationNodeAssembler(events, views)
  const message = { id: 'reply-1', senderId: 'user', senderName: 'User', senderKind: 'user', text: '@Zenith @Argo check #12',
    mentions: ['zenith', 'argo'], reactions: [], deliveries: [{ targetId: 'zenith', accepted: false }, { targetId: 'argo', accepted: false }] }
  const inputs = [0, 1, 2, 3].map(seq => ({ event: event('team/chat-message', { version: 1,
    ...(seq === 0 ? {} : { update: true }), message: { ...message, supervised: seq === 3,
      deliveries: message.deliveries.map((value, index) => ({ ...value, accepted: seq > index })) } }, seq), view: undefined }))
  assembler.replaceWindow([inputs[0]!], false)
  assembler.flush()
  for (const input of inputs.slice(1)) { assembler.append(input); assembler.flush() }
  expect(assembler.snapshot('chat')).toHaveLength(1)
  expect(assembler.snapshot('chat')).toMatchObject([{ data: { senderKind: 'user', pendingDelivery: false } }])
  assembler.replaceWindow(inputs, false)
  assembler.flush()
  expect(assembler.snapshot('chat')).toHaveLength(1)
})
