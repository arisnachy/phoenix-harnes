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
  if ((match.event.type as string) === 'team/chat-message') {
    const data = record(match.event.data)
    const message = record(data?.message)
    if (data?.version !== 1 || typeof message?.id !== 'string' || typeof message.senderId !== 'string'
      || typeof message.senderName !== 'string' || typeof message.text !== 'string') return undefined
    return { messageId: message.id, senderId: message.senderId, senderName: message.senderName,
      senderKind: message.senderKind === 'user' ? 'user' : message.senderKind === 'kira' ? 'kira' : 'agent',
      ...(typeof message.avatar === 'string' ? { avatar: message.avatar } : {}),
      ...(typeof message.role === 'string' ? { role: message.role } : {}),
      ...(typeof message.missionId === 'string' ? { missionId: message.missionId } : {}),
      targetId: typeof message.targetId === 'string' ? message.targetId : '',
      ...(typeof message.targetId === 'string' && message.targetId === message.missionId
        ? { targetName: 'Kira' } : {}),
      ...(typeof message.replyTo === 'string' ? { replyTo: message.replyTo } : {}),
      ...(typeof message.replyQuote === 'string' ? { replyQuote: message.replyQuote } : {}),
      pendingDelivery: Array.isArray(message.deliveries) && message.deliveries.some(item => record(item)?.accepted === false),
      content: [{ type: 'text', text: message.text }], time: match.event.time, seq: match.event.seq, reactions: [] }
  }
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
    senderKind: message.senderName === 'lead' ? 'kira' : 'agent',
    ...(typeof data.teamId === 'string' ? { missionId: data.teamId } : {}),
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

function delegated(match: ConversationMatch): KiraTeamMessageChatData | undefined {
  if ((match.event.type as string) !== 'team/member') return undefined
  const data = record(match.event.data)
  const member = record(data?.member)
  if (data?.version !== 1 || typeof data.teamId !== 'string'
    || typeof member?.id !== 'string' || typeof member.name !== 'string'
    || typeof member.description !== 'string' || !['provisioning', 'active'].includes(String(member.phase))) return undefined
  return {
    messageId: `team-member:${member.id}`,
    senderId: data.teamId,
    senderName: 'lead',
    senderKind: 'kira',
    missionId: data.teamId,
    targetId: member.id,
    targetName: member.name,
    purpose: 'assignment',
    content: [{ type: 'text', text: member.description }],
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
    if ((event.type as string) === 'team/member') {
      const data = record(event.data)
      const member = record(data?.member)
      return data?.version === 1 && typeof data.teamId === 'string'
        && ['provisioning', 'active'].includes(String(member?.phase)) && typeof member?.id === 'string'
        && typeof member.name === 'string' && typeof member.description === 'string'
        ? { id: `team-member:${member.id}`, role: member.phase === 'provisioning' ? 'start' : 'update' }
        : null
    }
    if ((event.type as string) === 'team/message/queued' || (event.type as string) === 'team/chat-message') {
      const data = record(event.data)
      const message = record(data?.message)
      // Historical generated tool-activity rows never enter the visible chat
      // projection. Genuine teammate messages remain available unchanged.
      if (typeof message?.id === 'string' && typeof message.senderId === 'string'
        && message.id.startsWith(message.senderId + ':activity:')) return null
      return typeof message?.id === 'string' ? { id: message.id, role: data?.update === true ? 'update' : 'start' } : null
    }
    if ((event.type as string) === 'team/reaction') {
      const data = record(event.data)
      const value = record(data?.reaction)
      return typeof value?.messageId === 'string' ? { id: value.messageId, role: 'update' } : null
    }
    return null
  },
  start: (_context, match) => {
    const data = queued(match) ?? delegated(match)
    if (data === undefined) throw new Error('kira-team-message start requires a valid team/message/queued event')
    return data
  },
  update: (context, match) => {
    if ((match.event.type as string) === 'team/chat-message') {
      const message = queued(match)
      return message === undefined ? context.state : { ...context.state, ...message, reactions: context.state.reactions }
    }
    const assignment = delegated(match)
    if (assignment?.targetName !== undefined) return { ...context.state, targetName: assignment.targetName }
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
