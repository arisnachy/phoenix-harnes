/** Durable, model-hidden conversation records shared by the team and ordinary chat. */
export interface TeamChatReaction {
  readonly id: string
  readonly messageId: string
  readonly reactorId: string
  readonly reactorName: string
  readonly reactorKind: 'user' | 'kira' | 'agent'
  readonly emoji: string
  readonly createdAt: number
}
/** A public root transcript row; later durable snapshots keep the same identity. */
export interface TeamChatMessage {
  readonly id: string
  readonly senderId: string
  readonly senderName: string
  readonly senderKind: 'user' | 'kira' | 'agent'
  readonly avatar?: string | undefined
  readonly role?: string | undefined
  readonly missionId?: string | undefined
  readonly text: string
  readonly time: number
  readonly sourceSeq: number
  readonly targetId?: string | undefined
  readonly replyTo?: string | undefined
  readonly replyQuote?: string | undefined
  readonly mentions: readonly string[]
  readonly supervised?: boolean | undefined
  readonly deliveries?: readonly {
    readonly targetId: string
    readonly accepted: boolean
    readonly error?: string | undefined
  }[] | undefined
  readonly reactions: readonly TeamChatReaction[]
}
/** A stable mission-owned identity retained after the child completes. */
export interface TeamChatParticipant {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly status: string
  readonly avatar?: string | undefined
  readonly task?: string | undefined
  readonly missionId?: string | undefined
}
/** Detached public transcript and real participant identities; reading never wakes agents. */
export interface TeamChatReadResult { readonly messages: TeamChatMessage[]
  readonly participants: TeamChatParticipant[] }
/** A live root identity and optional bounded message count (1–200). */
export interface TeamChatReadRequest { readonly sessionId: string
  readonly limit?: number }
/** A per-actor Unicode emoji set/remove on an existing public message. */
export interface TeamChatReactRequest extends TeamChatReadRequest {
  readonly messageId: string
  readonly emoji: string
  readonly active: boolean
}
/** A retry-stable human request to existing continuable direct children. */
export interface TeamChatReplyRequest extends TeamChatReadRequest {
  readonly requestId: string
  readonly targetId: string
  readonly targetIds?: readonly string[]
  readonly text: string
  readonly replyTo?: string | undefined
}
declare module '@phoenix-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete, stable real child identity and operational state in its mission. */
    'team/chat-participant': { readonly version: 1
      readonly participant: TeamChatParticipant }
    /** Actual child output copied into its root's transcript, never model history. */
    'team/chat-message': { readonly version: 1
      readonly update?: true
      readonly message: TeamChatMessage }
    /** Idempotent per-person, per-emoji set/remove mutation, without waking a model. */
    'team/chat-reaction': { readonly version: 1
      readonly reaction: TeamChatReaction
      readonly active: boolean }
  }
}

declare module '@phoenix-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { teamChatParticipants: Record<string, TeamChatParticipant>
    teamChatReactions: Record<string, TeamChatReaction[]> }
}
