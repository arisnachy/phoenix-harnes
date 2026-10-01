/** Conversation projection for real Agent Teams peer messages and reactions. */

import type {
  ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@phoenix-ai/dsh-client-runtime/client'
import type {
  ChatNode, KiraTeamMessageChatData, KiraTeamReactionChatData,
} from '../contract/chat-nodes.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function queued(match: ConversationMatch): KiraTeamMessageChatData | undefined {
  if ((match.event.type as string) !== 'team/message/queued') return undefined
  const data = record(match.event.data)
  const message = record(data?.message)
  const content = message?.content
  if (data?.version !== 1 || typeof message?.id !== 'string'
    || typeof message.senderId !== 'string' || typeof message.senderName !== 'string'
    || typeof message.targetId !== 'string' || !Array.isArray(content)) return undefined
  return {
    messageId: message.id,
    senderId: message.senderId,
    senderName: message.senderName,
    targetId: message.targetId,
    ...typeof message.targetName === 'string' ? { targetName: message.targetName } : {},
    ...typeof message.purpose === 'string'
      && ['assignment', 'question', 'blocker', 'result', 'review', 'decision', 'update'].includes(message.purpose)
      ? { purpose: message.purpose as NonNullable<KiraTeamMessageChatData['purpose']> }
      : {},
    content,
    time: match.event.time,
    seq: match.event.seq,
    reactions: [],
  }
}

function reaction(match: ConversationMatch): {
  readonly messageId: string
  readonly value: KiraTeamReactionChatData
} | undefined {
  if ((match.event.type as string) !== 'team/reaction') return undefined
  const data = record(match.event.data)
  const value = record(data?.reaction)
  if (data?.version !== 1 || typeof value?.messageId !== 'string'
    || typeof value.reactorId !== 'string' || typeof value.reactorName !== 'string'
    || !['ack', 'agree', 'insight', 'blocked', 'done'].includes(String(value.reaction))) return undefined
  return {
    messageId: value.messageId,
    value: {
      reactorId: value.reactorId,
      reactorName: value.reactorName,
      reaction: value.reaction as KiraTeamReactionChatData['reaction'],
    },
  }
}

function viewNode(
  context: ConversationNodeContext<KiraTeamMessageChatData>,
  state: KiraTeamMessageChatData,
): ChatNode<'kira-team-message'> {
  return {
    key: context.key,
    kind: 'kira-team-message',
    id: context.id,
    target: 'chat',
    anchorSeq: state.seq,
    location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    visibility: 'visible',
    data: state,
  }
}

/** Correlate real Team messages with subsequent semantic reactions. */
export const kiraTeamMessageDefinition: ConversationNodeDefinition<KiraTeamMessageChatData> = {
  kind: 'kira-team-message',
  target: 'chat',
  match: (event) => {
    if ((event.type as string) === 'team/message/queued') {
      const data = record(event.data)
      const message = record(data?.message)
      return typeof message?.id === 'string' ? { id: message.id, role: 'start' } : null
    }
    if ((event.type as string) === 'team/reaction') {
      const data = record(event.data)
      const value = record(data?.reaction)
      return typeof value?.messageId === 'string' ? { id: value.messageId, role: 'update' } : null
    }
    return null
  },
  start: (_context, match) => {
    const data = queued(match)
    if (data === undefined) throw new Error('kira-team-message start requires a valid team/message/queued event')
    return data
  },
  update: (context, match) => {
    const next = reaction(match)
    if (next === undefined || next.messageId !== context.state.messageId) return context.state
    if (context.state.reactions.some(item => item.reactorId === next.value.reactorId)) return context.state
    return { ...context.state, reactions: [...context.state.reactions, next.value] }
  },
  buildViewNode: context => context.state === undefined ? null : viewNode(context, context.state),
}

/**
 * Register KIRA Team durable peer messages in the ordinary Chat projection.
 * @param ctx - owning Conversation package context.
 */
export function registerKiraTeamMessageNode(
  ctx: { conversationEvents: { register(definition: ConversationNodeDefinition<KiraTeamMessageChatData>): unknown } },
): void {
  ctx.conversationEvents.register(kiraTeamMessageDefinition)
}
