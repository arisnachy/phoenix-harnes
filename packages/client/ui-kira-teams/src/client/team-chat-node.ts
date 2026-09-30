/** Conversation projection for real Agent Teams peer messages and reactions. */

import type {
  ConversationNodeContext, ConversationNodeDefinition,
} from '@phoenix-ai/dsh-client-runtime/client'
import type {
  ChatNode, ChatNodeDataMap,
} from '@phoenix-ai/dsh-client-ui-conversation/client'

/** One lightweight reaction rendered under a real Team message. */
export interface KiraTeamReactionChatData {
  readonly reactorId: string
  readonly reactorName: string
  readonly reaction: 'ack' | 'agree' | 'insight' | 'blocked' | 'done'
}

/** Durable Team message projected into the ordinary Phoenix chat stream. */
export interface KiraTeamMessageChatData {
  readonly messageId: string
  readonly senderId: string
  readonly senderName: string
  readonly targetId: string
  readonly targetName?: string
  readonly content: readonly unknown[]
  readonly time: number
  readonly seq: number
  readonly reactions: readonly KiraTeamReactionChatData[]
}

declare module '@phoenix-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Real peer-to-peer KIRA Team collaboration, never synthetic role-play. */
    'kira-team-message': KiraTeamMessageChatData
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function queued(match: Parameters<ConversationNodeDefinition['start']>[1]): KiraTeamMessageChatData | undefined {
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
    content,
    time: match.event.time,
    seq: match.event.seq,
    reactions: [],
  }
}

function reaction(match: Parameters<ConversationNodeDefinition['update']>[1]): {
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
  buildViewNode: (context) => context.state === undefined ? null : viewNode(context, context.state),
}

/** Register the Team transcript projection in the shared conversation assembler. */
export function registerKiraTeamConversationNode(
  conversationEvents: { register(definition: ConversationNodeDefinition<KiraTeamMessageChatData>): () => void },
): () => void {
  return conversationEvents.register(kiraTeamMessageDefinition)
}
