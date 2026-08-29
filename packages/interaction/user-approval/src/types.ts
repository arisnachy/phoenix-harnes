/**
 * Wire-safe approval identifiers and outcome vocabulary, free of
 * cordis/service imports so browser type chains (apiproxy api → client) can
 * consume them without loading this package's Context augmentation.
 * @module @phoenix-ai/dsh-user-approval/types
 */

import type { Branded } from '@phoenix-ai/dsh-brand'

/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
export type ApprovalRequestId = Branded<'ApprovalRequestId'>

/**
 * Brand a string as an {@link ApprovalRequestId}.
 * @param id - the raw id string to brand.
 * @returns the same string carrying the brand.
 */
export function ApprovalRequestId(id: string): ApprovalRequestId {
  return id as ApprovalRequestId
}

/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** Risk classes used to choose a bounded automatic approval outcome. */
export type ApprovalRisk = 'low' | 'medium' | 'high'

/** The only outcomes the host may apply when a user does not answer in time. */
export type ApprovalRecommendation = 'allowed-once' | 'rejected'

/** Durable deadline material shared by host frames and session audit events. */
export interface ApprovalDeadline {
  /** Wall-clock time at which the request entered the answerer chain. */
  readonly requestedAt: number
  /** Wall-clock time after which the automatic recommendation is applied. */
  readonly expiresAt: number
  /** Risk class used to derive the recommendation. */
  readonly risk: ApprovalRisk
  /** Outcome used when the deadline expires and the policy revision is current. */
  readonly recommendation: ApprovalRecommendation
  /** Number of policy events observed when the request was created. */
  readonly policyRevision: number
}
