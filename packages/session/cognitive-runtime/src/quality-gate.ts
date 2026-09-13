/** Completion-quality gate used at the agent turn-stopping boundary. */

import type { SessionEvent } from '@phoenix-ai/dsh-session'

/**
 * Internal steering message used once after a tool-using turn appears ready to
 * close. The second stop boundary is allowed through, so this cannot create an
 * unbounded self-review loop.
 */
export const COMPLETION_AUDIT_PROMPT = [
  'Completion audit before closing this turn.',
  'Compare the user\'s actual goal and constraints with the evidence produced in this turn, including tool results and created or modified artifacts.',
  'If any requested work is incomplete, incorrect, unverified, or contradicted by the evidence and you can repair it now, continue the work and repair it.',
  'If the work is complete, give the user the final result and cite the concrete evidence that supports completion when useful.',
  'Do not invent successful tests, writes, pushes, files, tool results, or verification that did not occur.',
  'If a real external blocker prevents completion, name the external blocker precisely and preserve the unfinished commitment instead of claiming success.',
].join(' ')

/**
 * Decide whether the turn deserves one extra completion-audit model step.
 * Tool-free conversational turns close normally; tool-using turns are audited
 * exactly once by the service integration.
 */
export function turnNeedsQualityAudit(
  events: readonly SessionEvent[],
  turn: number,
  alreadyAudited: boolean,
): boolean {
  if (alreadyAudited) return false
  return events.some(event => event.type === 'tool/call' && event.data.turn === turn)
}
