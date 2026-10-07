/** Local assistant mail transport and durable work vocabulary. */

import type { Branded } from '@phoenix-ai/dsh-brand'
import type { SessionId } from '@phoenix-ai/dsh-session'

/** Opaque provider message identity. */
export type MailMessageId = Branded<'MailMessageId'>
/** Opaque provider thread identity. */
export type MailThreadId = Branded<'MailThreadId'>
/** Durable local work identity. */
export type MailJobId = Branded<'MailJobId'>

/** Construct a provider message identity at a validated boundary.
 * @param value Validated provider identifier.
 * @returns Nominal message identity.
 */
export function MailMessageId(value: string): MailMessageId { return value as MailMessageId }
/** Construct a provider thread identity at a validated boundary.
 * @param value Validated provider identifier.
 * @returns Nominal thread identity.
 */
export function MailThreadId(value: string): MailThreadId { return value as MailThreadId }
/** Construct a durable local work identity.
 * @param value Validated local identifier.
 * @returns Nominal job identity.
 */
export function MailJobId(value: string): MailJobId { return value as MailJobId }

/** Provider-authenticated inbound mail. Headers/body never grant authority. */
export interface MailMessage {
  readonly inboxId: string
  readonly messageId: MailMessageId
  readonly threadId: MailThreadId
  readonly from: string
  readonly subject: string
  readonly text: string
  readonly authenticated: boolean
  readonly automatic: boolean
}
/** One authenticated-only page of provider message identities. */
export interface MailPage { readonly ids: readonly MailMessageId[]; readonly next?: string }
/** Exact reply destination and immutable idempotency key. */
export interface MailReply {
  readonly inboxId: string
  readonly messageId: MailMessageId
  readonly to: string
  readonly text: string
  readonly idempotencyKey: string
}
/** Persisted scheduled occurrence and recipient whose authorization is rechecked before each attempt. */
export interface MailOutgoingOwnership {
  readonly taskId: string
  readonly scheduledFor: string
  readonly to: string
  readonly idempotencyKey: string
}
/** Immutable new message retained before provider IO. */
export interface MailOutgoingMessage extends MailOutgoingOwnership {
  readonly inboxId: string
  readonly subject: string
  readonly text: string
}
/** Provider confirmation, distinct from mail merely queued locally. */
export interface MailDelivery { readonly messageId: MailMessageId; readonly threadId: MailThreadId }
/** Provider IO, independent of agent/model execution. */
export interface AssistantMailTransport {
  /** List only authenticated, non-spam, non-blocked incoming mail.
   * @param cursor Provider pagination token.
   * @returns A page of candidate message identities.
   */
  listMessages(cursor?: string): Promise<MailPage>
  /** Read a candidate through the authenticated transport.
   * @param id Candidate message identity.
   * @returns Complete bounded message with provider authentication classification.
   */
  readMessage(id: MailMessageId): Promise<MailMessage>
  /** Send only the fixed owner-authorized reply.
   * @param request Original message, destination, content and idempotency key.
   * @returns Confirmed provider receipt.
   */
  reply(request: MailReply): Promise<MailDelivery>
  /** Subscribe to wake notifications, not execution authority.
   * @param onMessage Callback to request a reconciliation.
   * @param onDisconnected Callback reporting a closed/error channel.
   * @returns Disposer for the outgoing subscription.
   */
  subscribe(onMessage: () => void, onDisconnected?: () => void): Promise<() => void>
}
/** Non-secret result of checking a human AgentMail Console API key before adoption. */
export interface MailConsoleKeyCheck {
  readonly valid: true
  readonly organizationId: string
  readonly authenticationType?: string
  readonly scopeType?: 'organization' | 'pod' | 'inbox'
  readonly inboxCount: number
  readonly inboxLimit?: number
  readonly capacityAvailable: boolean
  readonly inboxRead: boolean
  readonly inboxCreate?: boolean
  readonly messageSend?: boolean
  /** Present when Kira already has a ready inbox and the candidate key was checked against it. */
  readonly currentInboxAccess?: boolean
  readonly messageRead?: boolean
  readonly realtime?: boolean
}

/** Local enrollment state, containing no secret values. */
export interface MailAccount {
  readonly state: 'not-configured' | 'signup-ambiguous' | 'pending-verification' | 'ready'
  readonly ownerEmail?: string
  /** Whether AgentMail has actually attached the human owner to an agent-created organization. */
  readonly ownerLink?: 'attached' | 'pending' | 'provider-conflict'
  readonly inboxId?: string
  readonly sessionId?: SessionId
  readonly contacts: readonly string[]
}
/** Durable job state never interprets agent acceptance as completion. */
export interface MailJob {
  readonly id: MailJobId
  readonly updatedAt: string
  readonly message: MailMessage
  readonly state: 'received' | 'pending' | 'running' | 'verifying' | 'reply-pending' | 'replied' | 'blocked'
  readonly sessionId?: SessionId
  readonly outcome?: 'completed' | 'blocked'
  readonly summary?: string
  readonly evidence?: string
  readonly error?: string
}
