/** Live reaction projection carried by the existing session projection stream. */
import z from 'zod'
import type { ProjectionDefinition } from '@phoenix-ai/dsh-session-projection'
import type { TeamChatReaction } from './chat-types.ts'
import { TeamId } from './types.ts'

declare module '@phoenix-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { teamChatReactions: Record<string, TeamChatReaction[]> }
  interface SessionProjectionStateMap { teamChatReactions: Record<string, TeamChatReaction[]> }
}
/** Strict schema for a durable Unicode reaction identity. */
export const chatReactionSchema = z.object({ id: z.string(), messageId: z.string(), reactorId: z.string(),
  reactorName: z.string(), reactorKind: z.enum(['user', 'kira', 'agent']), emoji: z.string(), createdAt: z.number() }).strict()
const schema = z.record(z.string(), z.array(chatReactionSchema))
const LEGACY_REACTION_EMOJI = {
  ack: '👍',
  agree: '🤝',
  insight: '💡',
  blocked: '⚠️',
  done: '✅',
} as const
/** Fold idempotent actor/emoji mutations into the ordinary Session projection. */
export const teamChatReactionsDefinition = {
  key: 'teamChatReactions', stateVersion: 2, stateSchema: schema, init: () => ({}),
  apply: (state, event) => {
    if (event.type === 'team/reaction' && z.literal(1).safeParse(event.data.version).success) {
      const value = event.data.reaction
      const emoji = LEGACY_REACTION_EMOJI[value.reaction]
      const parsed = chatReactionSchema.safeParse({
        id: `legacy:${value.messageId}:${value.reactorId}`,
        messageId: value.messageId,
        reactorId: value.reactorId,
        reactorName: value.reactorName,
        reactorKind: TeamId(value.reactorId) === event.data.teamId ? 'kira' : 'agent',
        emoji,
        createdAt: event.time,
      })
      if (!parsed.success) return state
      const prior = state[value.messageId] ?? []
      const remaining = prior.filter(item => item.reactorId !== value.reactorId || item.emoji !== emoji)
      return { ...state, [value.messageId]: [...remaining, parsed.data] }
    }
    if (event.type !== 'team/chat-reaction' || !z.literal(1).safeParse(event.data.version).success) return state
    const value = event.data.reaction
    const parsed = chatReactionSchema.safeParse(value)
    if (!parsed.success || typeof event.data.active !== 'boolean') return state
    const prior = state[value.messageId] ?? []
    const remaining = prior.filter(item => item.reactorId !== value.reactorId || item.emoji !== value.emoji)
    return { ...state, [value.messageId]: event.data.active ? [...remaining, parsed.data] : remaining }
  },
  wire: { viewSchema: schema, view: state => state },
} satisfies ProjectionDefinition<'teamChatReactions'>

/** Strict schema for mission-owned participant identity and operational status. */
export const chatParticipantSchema = z.object({
  id: z.string(), name: z.string(),
  role: z.string(), status: z.string(), avatar: z.string().optional(), task: z.string().optional(),
  missionId: z.string().optional(),
}).strict()
const participantsSchema = z.record(z.string(), chatParticipantSchema)
declare module '@phoenix-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { teamChatParticipants: Record<string, import('./chat-types.ts').TeamChatParticipant> }
  interface SessionProjectionStateMap { teamChatParticipants: Record<string, import('./chat-types.ts').TeamChatParticipant> }
}
/** Stable real roster identity, independent of the model route or completion ordering. */
export const teamChatParticipantsDefinition = {
  key: 'teamChatParticipants', stateVersion: 1, stateSchema: participantsSchema, init: () => ({}),
  apply: (state, event) => {
    if (event.type === 'team/chat-participant' && z.literal(1).safeParse(event.data.version).success) {
      const value = chatParticipantSchema.safeParse(event.data.participant)
      return value.success ? { ...state, [value.data.id]: value.data } : state
    }
    if (event.type !== 'team/member') return state
    const member = event.data.member
    const value = chatParticipantSchema.safeParse({
      ...state[member.id], id: member.id, name: state[member.id]?.name ?? member.name,
      role: state[member.id]?.role ?? member.description, status: member.phase,
    })
    return value.success ? { ...state, [member.id]: value.data } : state
  },
  wire: { viewSchema: participantsSchema, view: state => state },
} satisfies ProjectionDefinition<'teamChatParticipants'>

/** Strict durable replay boundary: malformed records never become transcript state. */
export const chatMessageSchema = z.object({
  id: z.string().min(1), senderId: z.string().min(1), senderName: z.string(), senderKind: z.enum(['user', 'kira', 'agent']),
  avatar: z.string().optional(), role: z.string().optional(), missionId: z.string().optional(), text: z.string(),
  time: z.number(), sourceSeq: z.number().int().nonnegative(), targetId: z.string().optional(),
  replyTo: z.string().optional(), replyQuote: z.string().optional(), mentions: z.array(z.string()),
  supervised: z.boolean().optional(),
  deliveries: z.array(z.object({ targetId: z.string(), accepted: z.boolean(), error: z.string().optional() }).strict()).optional(),
  reactions: z.array(chatReactionSchema),
}).strict()
